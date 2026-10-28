import { z } from 'zod'
import { runtime } from '../config/runtime.js'
import { badRequest, conflict } from '../errors/app-error.js'
import { TableRepository, type TableItem } from '../repositories/table-repository.js'
import { customFieldDefinitionSchema, validateTemplate } from '../domain/custom-fields.js'
import { createAuditRecord } from './audit-service.js'

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  timeZone: z.string().trim().min(1).max(80).optional(),
  dailyDurationDays: z.number().int().min(1).max(365).optional(),
  weeklyInstallments: z.number().int().min(1).max(52).optional(),
}).strict()

export interface BusinessSettings {
  name: string
  timeZone: string
  dailyDurationDays: number
  weeklyInstallments: number
  version: number
}

const defaults: BusinessSettings = {
  name: 'Agaram Finance',
  timeZone: 'Asia/Kolkata',
  dailyDurationDays: 90,
  weeklyInstallments: 10,
  version: 1,
}

export class BusinessService {
  constructor(private readonly repository: TableRepository) {}

  async getSettings(): Promise<BusinessSettings> {
    const item = await this.repository.get<TableItem>(this.settingsKey())
    if (!item) return defaults
    return {
      name: String(item.name),
      timeZone: String(item.timeZone),
      dailyDurationDays: Number(item.dailyDurationDays),
      weeklyInstallments: Number(item.weeklyInstallments),
      version: Number(item.version),
    }
  }

  async updateSettings(input: unknown, actorUserId: string, requestId: string) {
    const parsed = settingsSchema.safeParse(input)
    if (!parsed.success) throw badRequest('Business settings are invalid.')
    if (Object.keys(parsed.data).length === 0) throw badRequest('Provide at least one setting to update.')
    if (parsed.data.timeZone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: parsed.data.timeZone })
      } catch {
        throw badRequest('timeZone must be a valid IANA timezone.')
      }
    }
    const existing = await this.repository.get<TableItem>(this.settingsKey())
    const current = existing ? await this.getSettings() : defaults
    const updated = { ...current, ...parsed.data, version: current.version + 1 }
    const item = this.settingsItem(updated)
    const audit = createAuditRecord({
      actorUserId,
      action: 'business_settings_updated',
      entityType: 'BUSINESS',
      entityId: runtime.businessId(),
      requestId,
    })
    try {
      await this.repository.transact({
        TransactItems: [
          {
            Put: {
              TableName: process.env.TABLE_NAME,
              Item: item,
              ...(existing
                ? {
                    ConditionExpression: '#version = :version',
                    ExpressionAttributeNames: { '#version': 'version' },
                    ExpressionAttributeValues: { ':version': current.version },
                  }
                : { ConditionExpression: 'attribute_not_exists(PK)' }),
            },
          },
          { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
        ],
      })
    } catch (error) {
      if (error instanceof Error && (error.name === 'TransactionCanceledException' || error.name === 'ConditionalCheckFailedException')) {
        throw conflict('Business settings changed in another request. Reload and try again.')
      }
      throw error
    }
    return updated
  }

  async getTemplate(entityType: 'CUSTOMER' | 'LOAN' | 'STAFF') {
    const item = await this.repository.get<TableItem>(this.templateKey(entityType))
    return (item?.fields as unknown[] | undefined) ?? []
  }

  async setTemplate(
    entityType: 'CUSTOMER' | 'LOAN' | 'STAFF',
    input: unknown,
    actorUserId: string,
    requestId: string,
  ) {
    const fields = validateTemplate(input)
    const existing = await this.repository.get<TableItem>(this.templateKey(entityType))
    const retired = (existing?.retiredFields as unknown[] | undefined) ?? []
    const oldFields = validateTemplate(existing?.fields ?? [])
    const history = [...retired, ...oldFields].map((field) => customFieldDefinitionSchema.parse(field))
    for (const field of fields) {
      const prior = history.find((candidate) => candidate.key === field.key)
      if (prior && prior.type !== field.type) {
        throw badRequest(`The type of "${field.key}" cannot change because existing records use it.`)
      }
    }
    const activeKeys = new Set(fields.map((field) => field.key))
    const retiredFields = [
      ...history,
      ...oldFields.filter((field) => !activeKeys.has(field.key)),
    ].filter((field, index, all) => all.findIndex((candidate) => candidate.key === field.key) === index)
    const updatedAt = new Date().toISOString()
    const item: TableItem = {
      ...this.templateKey(entityType),
      entityType: 'CUSTOM_FIELD_TEMPLATE',
      businessId: runtime.businessId(),
      appliesTo: entityType,
      fields,
      retiredFields,
      version: Number(existing?.version ?? 0) + 1,
      updatedAt,
      updatedBy: actorUserId,
    }
    const audit = createAuditRecord({
      actorUserId,
      action: 'custom_field_template_updated',
      entityType: 'BUSINESS',
      entityId: runtime.businessId(),
      requestId,
      metadata: { appliesTo: entityType, fieldCount: fields.length },
    })
    try {
      await this.repository.transact({
        TransactItems: [
          {
            Put: {
              TableName: process.env.TABLE_NAME,
              Item: item,
              ...(existing
                ? {
                    ConditionExpression: '#version = :version',
                    ExpressionAttributeNames: { '#version': 'version' },
                    ExpressionAttributeValues: { ':version': existing.version },
                  }
                : { ConditionExpression: 'attribute_not_exists(PK)' }),
            },
          },
          { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
        ],
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TransactionCanceledException') {
        throw conflict('The custom-field template changed in another request. Reload and try again.')
      }
      throw error
    }
    return fields
  }

  async getCustomFieldDefinitions(entityType: 'CUSTOMER' | 'LOAN' | 'STAFF') {
    const fields = await this.getTemplate(entityType)
    const parsed = z.array(customFieldDefinitionSchema).safeParse(fields)
    if (!parsed.success) throw new Error(`Stored ${entityType.toLowerCase()} custom-field template is invalid.`)
    return parsed.data
  }

  settingsKey() {
    return { PK: `BUSINESS#${runtime.businessId()}`, SK: 'SETTINGS' }
  }

  settingsItem(settings: BusinessSettings): TableItem {
    return {
      ...this.settingsKey(),
      entityType: 'BUSINESS_SETTINGS',
      businessId: runtime.businessId(),
      ...settings,
      updatedAt: new Date().toISOString(),
    }
  }

  templateKey(entityType: 'CUSTOMER' | 'LOAN' | 'STAFF') {
    return { PK: `BUSINESS#${runtime.businessId()}`, SK: `TEMPLATE#${entityType}` }
  }
}
