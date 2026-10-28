import { z } from 'zod'
import { runtime } from '../config/runtime.js'
import { cursorForQuery, nextCursor, parsePageSize } from '../domain/pagination.js'
import { displayPhone, legacyPhoneCandidates, normalizeLocalPhone, normalizePhone, phoneLookupKey } from '../domain/phone.js'
import { badRequest, conflict, notFound } from '../errors/app-error.js'
import type { Principal } from './auth-service.js'
import { AuthService } from './auth-service.js'
import { BusinessService } from './business-service.js'
import { createAuditRecord } from './audit-service.js'
import { updateCustomFields, validateCustomFields, validateTemplate, type CustomFieldDefinition } from '../domain/custom-fields.js'
import { isConditionalFailure, TableRepository, type TableItem } from '../repositories/table-repository.js'
import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb'

const staffCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(8).max(24),
  customFields: z.record(z.string(), z.unknown()).optional(),
}).strict()

const staffUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/),
  customFields: z.record(z.string(), z.unknown()).optional(),
}).partial().strict()

export class StaffService {
  constructor(
    private readonly repository: TableRepository,
    private readonly auth: AuthService,
    private readonly business: BusinessService,
  ) {}

  async create(input: unknown, actor: Principal, requestId: string) {
    const parsed = staffCreateSchema.safeParse(input)
    if (!parsed.success) throw badRequest('Staff details are invalid.')
    const phone = normalizeLocalPhone(parsed.data.phone)
    const definitions = await this.business.getCustomFieldDefinitions('STAFF')
    const customFields = validateCustomFields(parsed.data.customFields, definitions)
    const staffId = await this.repository.nextBusinessId(runtime.businessId(), 'STAFF')
    const temporaryPassword = this.auth.createTemporaryPassword('STAFF')
    const prepared = await this.auth.prepareUser({
      phone,
      password: temporaryPassword,
      role: 'STAFF',
      name: parsed.data.name,
      staffId,
      passwordChangeRequired: true,
    })
    const createdAt = new Date().toISOString()
    const staffProfile: TableItem = {
      PK: `STAFF#${staffId}`,
      SK: 'PROFILE',
      GSI2PK: `BUSINESS#${runtime.businessId()}#STAFF`,
      GSI2SK: `${createdAt}#${staffId}`,
      entityType: 'STAFF',
      businessId: runtime.businessId(),
      staffId,
      userId: staffId,
      name: parsed.data.name,
      phone,
      status: 'ACTIVE',
      customFields,
      customFieldDefinitions: definitions,
      createdAt,
      updatedAt: createdAt,
      version: 1,
    }
    const audit = createAuditRecord({
      actorUserId: actor.userId,
      action: 'staff_account_created',
      entityType: 'STAFF',
      entityId: staffId,
      requestId,
      occurredAt: createdAt,
    })
    try {
      await this.repository.transact({
        TransactItems: [
          { Put: { TableName: process.env.TABLE_NAME, Item: prepared.phoneMapping, ConditionExpression: 'attribute_not_exists(PK)' } },
          { Put: { TableName: process.env.TABLE_NAME, Item: prepared.user, ConditionExpression: 'attribute_not_exists(PK)' } },
          { Put: { TableName: process.env.TABLE_NAME, Item: staffProfile, ConditionExpression: 'attribute_not_exists(PK)' } },
          { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
        ],
      })
    } catch (error) {
      if (isConditionalFailure(error)) throw conflict('A user with this phone number already exists.', 'PHONE_ALREADY_EXISTS')
      throw error
    }
    return { staff: toPublicStaff(staffProfile), temporaryPassword }
  }

  async list(query: Record<string, string | undefined>) {
    const partition = `BUSINESS#${runtime.businessId()}#STAFF`
    const limit = parsePageSize(query.limit)
    const secret = await runtime.jwtSecret()
    const result = await this.repository.query({
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :partition',
      ExpressionAttributeValues: { ':partition': partition },
      Limit: limit,
      ScanIndexForward: false,
      ExclusiveStartKey: cursorForQuery(query.cursor, secret, 'GSI2PK', partition),
    })
    return {
      items: ((result.Items ?? []) as TableItem[]).map(toPublicStaff),
      nextCursor: nextCursor(result.LastEvaluatedKey, secret),
    }
  }

  async get(staffId: string) {
    const staff = await this.repository.get<TableItem>({ PK: `STAFF#${staffId}`, SK: 'PROFILE' })
    if (!staff) throw notFound('Staff member was not found.')
    return toPublicStaff(staff)
  }

  async update(staffId: string, input: unknown, actor: Principal, requestId: string) {
    const parsed = staffUpdateSchema.safeParse(input)
    if (!parsed.success) throw badRequest('Agent details are invalid.')
    if (Object.keys(parsed.data).length === 0) throw badRequest('Provide at least one field to update.')

    const [current, user] = await Promise.all([
      this.repository.get<TableItem>({ PK: `STAFF#${staffId}`, SK: 'PROFILE' }),
      this.repository.get<TableItem>({ PK: `USER#${staffId}`, SK: 'PROFILE' }),
    ])
    if (!current) throw notFound('Agent was not found.')
    if (!user || user.role !== 'STAFF') throw notFound('Agent login account was not found.')
    const currentPhone = normalizePhone(String(current.phone ?? ''))
    const newPhone = parsed.data.phone === undefined ? currentPhone : normalizeLocalPhone(parsed.data.phone)
    const newName = parsed.data.name ?? String(current.name)
    const definitions = await this.business.getCustomFieldDefinitions('STAFF')
    const customFields = parsed.data.customFields === undefined
      ? (current.customFields as Record<string, string | number | boolean> | undefined) ?? {}
      : updateCustomFields((current.customFields as Record<string, string | number | boolean> | undefined) ?? {}, parsed.data.customFields, definitions)
    const existingDefinitions = validateTemplate(current.customFieldDefinitions ?? [])
    const currentKeys = new Set(definitions.map((definition) => definition.key))
    const customFieldDefinitions = [...existingDefinitions.filter((field) => !currentKeys.has(field.key)), ...definitions] as CustomFieldDefinition[]
    const phoneSecret = await runtime.phoneLookupSecret()
    const [newLocalMapping, newLegacyMapping, oldMappings] = await Promise.all([
      this.repository.get<TableItem>({ PK: `PHONE#${phoneLookupKey(newPhone, phoneSecret)}`, SK: 'USER' }),
      this.repository.get<TableItem>({ PK: `PHONE#${phoneLookupKey(`+91${newPhone}`, phoneSecret)}`, SK: 'USER' }),
      Promise.all(legacyPhoneCandidates(currentPhone).map((candidate) =>
        this.repository.get<TableItem>({ PK: `PHONE#${phoneLookupKey(candidate, phoneSecret)}`, SK: 'USER' }),
      )),
    ])
    const newMappings = [newLocalMapping, newLegacyMapping]
    if (newMappings.some((mapping) => mapping && mapping.userId !== staffId)) {
      throw conflict('A user with this mobile number already exists.', 'PHONE_ALREADY_EXISTS')
    }

    const now = new Date().toISOString()
    const audit = createAuditRecord({
      actorUserId: actor.userId,
      action: 'staff_updated',
      entityType: 'STAFF',
      entityId: staffId,
      requestId,
      occurredAt: now,
      metadata: {
        before: JSON.stringify({ name: current.name, phone: displayPhone(currentPhone), customFields: current.customFields ?? {} }),
        after: JSON.stringify({ name: newName, phone: displayPhone(newPhone), customFields }),
      },
    })
    const newMappingKey = `PHONE#${phoneLookupKey(newPhone, phoneSecret)}`
    const actions: NonNullable<TransactWriteCommandInput['TransactItems']> = [
      {
          Put: {
          TableName: process.env.TABLE_NAME,
            Item: { ...current, name: newName, phone: newPhone, customFields, customFieldDefinitions, updatedAt: now, version: (typeof current.version === 'number' ? current.version : 0) + 1 },
            ConditionExpression: '#version = :staffVersion',
            ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues: {
            ':staffVersion': typeof current.version === 'number' ? current.version : 0,
          },
        },
      },
      {
        Update: {
          TableName: process.env.TABLE_NAME,
          Key: { PK: `USER#${staffId}`, SK: 'PROFILE' },
          UpdateExpression: 'SET #name = :name, #phone = :phone, updatedAt = :updatedAt, #version = if_not_exists(#version, :zero) + :one',
          ConditionExpression: 'attribute_exists(PK) AND #role = :role AND (attribute_not_exists(#version) OR #version = :userVersion)',
          ExpressionAttributeNames: { '#name': 'name', '#phone': 'phone', '#version': 'version', '#role': 'role' },
          ExpressionAttributeValues: {
            ':name': newName,
            ':phone': newPhone,
            ':updatedAt': now,
            ':zero': 0,
            ':one': 1,
            ':role': 'STAFF',
            ':userVersion': typeof user.version === 'number' ? user.version : 0,
          },
        },
      },
      ...(!newLocalMapping ? [{
        Put: {
          TableName: process.env.TABLE_NAME,
          Item: {
            PK: newMappingKey,
            SK: 'USER',
            entityType: 'PHONE_LOOKUP',
            businessId: runtime.businessId(),
            userId: staffId,
            createdAt: now,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      }] : []),
      ...oldMappings.flatMap((mapping, index) => {
          if (mapping?.userId !== staffId) return []
          const candidate = legacyPhoneCandidates(currentPhone)[index]
          const key = `PHONE#${phoneLookupKey(candidate, phoneSecret)}`
          return key === newMappingKey ? [] : [{
            Delete: {
              TableName: process.env.TABLE_NAME,
              Key: { PK: key, SK: 'USER' },
              ConditionExpression: 'userId = :userId',
              ExpressionAttributeValues: { ':userId': staffId },
            },
          }]
        }),
      { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
    ]

    try {
      await this.repository.transact({ TransactItems: actions })
    } catch (error) {
      if (isConditionalFailure(error)) {
        throw conflict('Agent details changed or the mobile number is already in use. Reload and try again.')
      }
      throw error
    }
    return {
      ...toPublicStaff({
        ...current,
        name: newName,
        phone: newPhone,
        customFields,
        customFieldDefinitions,
        updatedAt: now,
        version: (typeof current.version === 'number' ? current.version : 0) + 1,
      }),
    }
  }
}

function toPublicStaff(staff: TableItem) {
  const {
    PK: _pk,
    SK: _sk,
    GSI2PK: _gsi2pk,
    GSI2SK: _gsi2sk,
    entityType: _entityType,
    businessId: _businessId,
    phone: _phone,
    ...publicRecord
  } = staff
  return {
    ...publicRecord,
    ...(typeof staff.phone === 'string' ? { phone: displayPhone(staff.phone) } : {}),
  }
}
