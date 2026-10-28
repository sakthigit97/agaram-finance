import { z } from 'zod'
import { runtime } from '../config/runtime.js'
import { updateCustomFields, validateCustomFields, validateTemplate, type CustomFieldDefinition } from '../domain/custom-fields.js'
import { cursorForQuery, nextCursor, parsePageSize } from '../domain/pagination.js'
import { displayPhone, normalizeLocalPhone, normalizePhone, phoneLookupKey } from '../domain/phone.js'
import { badRequest, conflict, forbidden, notFound } from '../errors/app-error.js'
import type { Principal } from './auth-service.js'
import { AuthService } from './auth-service.js'
import { BusinessService } from './business-service.js'
import { createAuditRecord } from './audit-service.js'
import { isConditionalFailure, TableRepository, type TableItem } from '../repositories/table-repository.js'

const customerCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(8).max(24),
  area: z.string().trim().min(2).max(100),
  address: z.string().trim().max(500).optional(),
  email: z.string().trim().email().max(254).optional(),
  notes: z.string().trim().max(1000).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
}).strict()

const customerUpdateSchema = customerCreateSchema.partial().extend({
  customFields: z.record(z.string(), z.unknown()).optional(),
}).strict()

export interface CustomerRecord extends TableItem {
  entityType: 'CUSTOMER'
  customerId: string
  userId: string
  name: string
  phone: string
  area: string
  customFields: Record<string, string | number | boolean>
  customFieldDefinitions: unknown[]
  createdAt: string
  updatedAt: string
  version: number
}

export class CustomerService {
  constructor(
    private readonly repository: TableRepository,
    private readonly auth: AuthService,
    private readonly business: BusinessService,
  ) {}

  async create(input: unknown, actor: Principal, requestId: string) {
    const parsed = customerCreateSchema.safeParse(input)
    if (!parsed.success) throw badRequest('Customer details are invalid.')
    const phone = normalizeLocalPhone(parsed.data.phone)
    const definitions = await this.business.getCustomFieldDefinitions('CUSTOMER')
    const customFields = validateCustomFields(parsed.data.customFields, definitions)
    const customerId = await this.repository.nextBusinessId(runtime.businessId(), 'CUSTOMER')
    const temporaryPassword = this.auth.createTemporaryPassword('CUSTOMER')
    const prepared = await this.auth.prepareUser({
      phone,
      password: temporaryPassword,
      role: 'CUSTOMER',
      name: parsed.data.name,
      customerId,
      passwordChangeRequired: true,
    })
    const now = new Date().toISOString()
    const customer: CustomerRecord = {
      PK: `CUSTOMER#${customerId}`,
      SK: 'PROFILE',
      GSI2PK: `BUSINESS#${runtime.businessId()}#CUSTOMERS`,
      GSI2SK: `${now}#${customerId}`,
      entityType: 'CUSTOMER',
      businessId: runtime.businessId(),
      customerId,
      userId: customerId,
      name: parsed.data.name,
      phone,
      area: parsed.data.area,
      customFields,
      customFieldDefinitions: definitions,
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...(parsed.data.address !== undefined ? { address: parsed.data.address } : {}),
      ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
    }
    const audit = createAuditRecord({
      actorUserId: actor.userId,
      action: 'customer_created',
      entityType: 'CUSTOMER',
      entityId: customerId,
      requestId,
      occurredAt: now,
    })
    try {
      await this.repository.transact({
        TransactItems: [
          { Put: { TableName: process.env.TABLE_NAME, Item: prepared.phoneMapping, ConditionExpression: 'attribute_not_exists(PK)' } },
          { Put: { TableName: process.env.TABLE_NAME, Item: prepared.user, ConditionExpression: 'attribute_not_exists(PK)' } },
          { Put: { TableName: process.env.TABLE_NAME, Item: customer, ConditionExpression: 'attribute_not_exists(PK)' } },
          { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
        ],
      })
    } catch (error) {
      if (isConditionalFailure(error)) throw conflict('A user with this phone number already exists.', 'PHONE_ALREADY_EXISTS')
      throw error
    }
    return {
      customer: toPublicCustomer(customer),
      temporaryPassword,
    }
  }

  async list(query: Record<string, string | undefined>) {
    const partition = `BUSINESS#${runtime.businessId()}#CUSTOMERS`
    const limit = parsePageSize(query.limit)
    const secret = await runtime.jwtSecret()
    const exclusiveStartKey = cursorForQuery(query.cursor, secret, 'GSI2PK', partition)
    const result = await this.repository.query({
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :partition',
      ExpressionAttributeValues: { ':partition': partition },
      Limit: limit,
      ScanIndexForward: false,
      ExclusiveStartKey: exclusiveStartKey,
    })
    const records = (result.Items ?? []) as CustomerRecord[]
    return {
      items: records.map(toPublicCustomer),
      nextCursor: nextCursor(result.LastEvaluatedKey, secret),
    }
  }

  async get(customerId: string, actor: Principal) {
    this.assertOwner(customerId, actor)
    const customer = await this.repository.get<CustomerRecord>({ PK: `CUSTOMER#${customerId}`, SK: 'PROFILE' })
    if (!customer) throw notFound('Customer was not found.')
    return toPublicCustomer(customer)
  }

  async update(customerId: string, input: unknown, actor: Principal, requestId: string) {
    const parsed = customerUpdateSchema.safeParse(input)
    if (!parsed.success) throw badRequest('Customer details are invalid.')
    if (Object.keys(parsed.data).length === 0) throw badRequest('Provide at least one field to update.')
    if (actor.role !== 'ADMIN') throw forbidden()
    const current = await this.repository.get<CustomerRecord>({ PK: `CUSTOMER#${customerId}`, SK: 'PROFILE' })
    if (!current) throw notFound('Customer was not found.')
    const normalizedCurrentPhone = normalizePhone(current.phone)
    const newPhone = parsed.data.phone === undefined ? normalizedCurrentPhone : normalizeLocalPhone(parsed.data.phone)
    const phoneChanged = newPhone !== current.phone
    let newPhoneMappingExists = false
    if (phoneChanged) {
      const phoneSecret = await runtime.phoneLookupSecret()
      const [localMapping, legacyMapping] = await Promise.all([newPhone, `+91${newPhone}`].map((candidate) =>
        this.repository.get<TableItem>({
          PK: `PHONE#${phoneLookupKey(candidate, phoneSecret)}`,
          SK: 'USER',
        }),
      ))
      if ([localMapping, legacyMapping].some((mapping) => mapping && mapping.userId !== current.userId)) {
        throw conflict('A user with this mobile number already exists.', 'PHONE_ALREADY_EXISTS')
      }
      newPhoneMappingExists = localMapping?.userId === current.userId
    }

    const definitions = await this.business.getCustomFieldDefinitions('CUSTOMER')
    const customFields = parsed.data.customFields === undefined
      ? current.customFields
      : updateCustomFields(current.customFields, parsed.data.customFields, definitions)
    const existingDefinitions = validateTemplate(current.customFieldDefinitions)
    const currentKeys = new Set(definitions.map((definition) => definition.key))
    const combinedDefinitions = [
      ...existingDefinitions.filter((definition) => !currentKeys.has(definition.key)),
      ...definitions,
    ] as CustomFieldDefinition[]
    const now = new Date().toISOString()
    const { phone: _submittedPhone, ...otherUpdates } = parsed.data
    const updated: CustomerRecord = {
      ...current,
      ...otherUpdates,
      phone: newPhone,
      customFields,
      customFieldDefinitions: combinedDefinitions,
      updatedAt: now,
      version: current.version + 1,
    }
    const setExpressions = [
      ...Object.keys(otherUpdates).filter((key) => key !== 'customFields').map((key) => `#${key} = :${key}`),
      '#phone = :phone',
      'customFields = :customFields',
      'customFieldDefinitions = :customFieldDefinitions',
      'updatedAt = :updatedAt',
      '#version = :nextVersion',
    ]
    const names = Object.fromEntries(Object.keys(otherUpdates).filter((key) => key !== 'customFields').map((key) => [`#${key}`, key]))
    names['#version'] = 'version'
    names['#phone'] = 'phone'
    const expressionValues: Record<string, unknown> = {
      ':customFields': customFields,
      ':customFieldDefinitions': combinedDefinitions,
      ':updatedAt': now,
      ':nextVersion': current.version + 1,
      ':version': current.version,
      ':phone': newPhone,
    }
    for (const key of Object.keys(otherUpdates).filter((field) => field !== 'customFields')) {
      expressionValues[`:${key}`] = otherUpdates[key as keyof typeof otherUpdates]
    }
    const nowPhoneMappingKey = `PHONE#${phoneLookupKey(newPhone, await runtime.phoneLookupSecret())}`
    const previousPhoneMappingKey = `PHONE#${phoneLookupKey(current.phone, await runtime.phoneLookupSecret())}`
    const audit = createAuditRecord({
      actorUserId: actor.userId,
      action: 'customer_updated',
      entityType: 'CUSTOMER',
      entityId: customerId,
      requestId,
      occurredAt: now,
      metadata: {
        before: JSON.stringify({ ...Object.fromEntries(Object.keys(otherUpdates).map((key) => [key, current[key as keyof CustomerRecord]])), phone: displayPhone(current.phone) }),
        after: JSON.stringify({ ...Object.fromEntries(Object.keys(otherUpdates).map((key) => [key, updated[key as keyof CustomerRecord]])), phone: displayPhone(newPhone) }),
      },
    })
    const actions = [
      {
        Update: {
          TableName: process.env.TABLE_NAME,
          Key: { PK: `CUSTOMER#${customerId}`, SK: 'PROFILE' },
          UpdateExpression: `SET ${setExpressions.join(', ')}`,
          ConditionExpression: '#version = :version',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: expressionValues,
        },
      },
      ...((parsed.data.name || phoneChanged)
        ? [{
            Update: {
              TableName: process.env.TABLE_NAME,
              Key: { PK: `USER#${customerId}`, SK: 'PROFILE' },
              UpdateExpression: `SET ${parsed.data.name ? '#name = :name, ' : ''}${phoneChanged ? '#phone = :phone, ' : ''}updatedAt = :updatedAt, #version = #version + :one`,
              ConditionExpression: 'attribute_exists(PK)',
              ExpressionAttributeNames: {
                ...(parsed.data.name ? { '#name': 'name' } : {}),
                ...(phoneChanged ? { '#phone': 'phone' } : {}),
                '#version': 'version',
              },
              ExpressionAttributeValues: {
                ...(parsed.data.name ? { ':name': parsed.data.name } : {}),
                ...(phoneChanged ? { ':phone': newPhone } : {}),
                ':updatedAt': now,
                ':one': 1,
              },
            },
          }]
        : []),
      ...(phoneChanged
        ? [
            ...(previousPhoneMappingKey !== nowPhoneMappingKey
              ? [{ Delete: { TableName: process.env.TABLE_NAME, Key: { PK: previousPhoneMappingKey, SK: 'USER' } } }]
              : []),
            ...(!newPhoneMappingExists ? [{ Put: { TableName: process.env.TABLE_NAME, Item: {
              PK: nowPhoneMappingKey,
              SK: 'USER',
              entityType: 'PHONE_LOOKUP',
              businessId: runtime.businessId(),
              userId: current.userId,
              createdAt: now,
            }, ConditionExpression: 'attribute_not_exists(PK)' } }] : []),
          ]
        : []),
      { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
    ]
    try {
      await this.repository.transact({
        TransactItems: actions,
      })
    } catch (error) {
      if (isConditionalFailure(error)) throw conflict('Customer changed in another request. Reload and try again.')
      throw error
    }
    return toPublicCustomer(updated)
  }

  private assertOwner(customerId: string, actor: Principal) {
    if (actor.role === 'CUSTOMER' && actor.customerId !== customerId) throw forbidden()
  }
}

function toPublicCustomer(customer: CustomerRecord) {
  const {
    PK: _pk,
    SK: _sk,
    GSI2PK: _gsi2pk,
    GSI2SK: _gsi2sk,
    entityType: _entityType,
    businessId: _businessId,
    phone: _phone,
    ...publicRecord
  } = customer
  return { ...publicRecord, phone: displayPhone(customer.phone) }
}
