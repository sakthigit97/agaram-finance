import { z } from 'zod'
import { runtime } from '../config/runtime.js'
import { createId } from '../domain/ids.js'
import { isIsoDate } from '../domain/dates.js'
import { cursorForQuery, nextCursor, parsePageSize } from '../domain/pagination.js'
import { badRequest, conflict, notFound } from '../errors/app-error.js'
import { isConditionalFailure, TableRepository, type TableItem } from '../repositories/table-repository.js'
import type { Principal } from './auth-service.js'
import { createAuditRecord } from './audit-service.js'

const expenseSchema = z.object({
  date: z.string().refine(isIsoDate),
  amountPaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().min(2).max(500),
  comments: z.string().trim().max(1000).optional(),
  agentId: z.string().min(1).optional(),
}).strict()

const investmentSchema = z.object({
  date: z.string().refine(isIsoDate),
  amountPaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  investorName: z.string().trim().min(2).max(120),
  comments: z.string().trim().max(1000).optional(),
}).strict()

type RecordKind = 'EXPENSE' | 'INVESTMENT'

export class FinanceRecordService {
  constructor(private readonly repository: TableRepository) {}

  async list(kind: RecordKind, query: Record<string, string | undefined>) {
    const { from, to } = parseDateRange(query.from, query.to)
    const partition = `BUSINESS#${runtime.businessId()}#${kind}S`
    const secret = await runtime.jwtSecret()
    const exclusiveStartKey = cursorForQuery(query.cursor, secret, 'GSI2PK', partition)
    if (exclusiveStartKey?.GSI2SK !== undefined
      && (typeof exclusiveStartKey.GSI2SK !== 'string'
        || exclusiveStartKey.GSI2SK < `${from}#`
        || exclusiveStartKey.GSI2SK > `${to}#\uffff`)) {
      throw badRequest('Pagination cursor does not match this date range.')
    }
    const result = await this.repository.query({
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :partition AND GSI2SK BETWEEN :from AND :to',
      ExpressionAttributeValues: { ':partition': partition, ':from': `${from}#`, ':to': `${to}#\uffff` },
      Limit: parsePageSize(query.limit),
      ScanIndexForward: false,
      ExclusiveStartKey: exclusiveStartKey,
    })
    return {
      items: ((result.Items ?? []) as TableItem[]).map(toPublicRecord),
      nextCursor: nextCursor(result.LastEvaluatedKey, secret),
    }
  }

  async create(kind: RecordKind, input: unknown, actor: Principal, requestId: string) {
    const parsed = kind === 'EXPENSE' ? expenseSchema.safeParse(input) : investmentSchema.safeParse(input)
    if (!parsed.success) throw badRequest(`${kind === 'EXPENSE' ? 'Expense' : 'Investment'} details are invalid.`)
    const data = parsed.data
    const id = createId(kind.toLowerCase())
    const now = new Date().toISOString()
    const agentId = kind === 'EXPENSE' && 'agentId' in data
      ? await this.resolveExpenseAgent(data.agentId, actor)
      : undefined
    const item: TableItem = {
      PK: `${kind}#${id}`,
      SK: 'PROFILE',
      GSI1PK: `BUSINESS#${runtime.businessId()}#DATE#${data.date}`,
      GSI1SK: `${kind}#${now}#${id}`,
      GSI2PK: `BUSINESS#${runtime.businessId()}#${kind}S`,
      GSI2SK: `${data.date}#${now}#${id}`,
      entityType: kind,
      businessId: runtime.businessId(),
      recordId: id,
      ...data,
      ...(agentId ? { agentId } : {}),
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
      version: 1,
    }
    const audit = createAuditRecord({
      actorUserId: actor.userId,
      action: `${kind.toLowerCase()}_created`,
      entityType: kind,
      entityId: id,
      requestId,
      occurredAt: now,
      metadata: { amountPaise: data.amountPaise },
    })
    try {
      await this.repository.transact({
        TransactItems: [
          { Put: { TableName: process.env.TABLE_NAME, Item: item, ConditionExpression: 'attribute_not_exists(PK)' } },
          { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
        ],
      })
    } catch (error) {
      if (isConditionalFailure(error)) throw conflict('This record could not be created because its ID already exists.')
      throw error
    }
    return toPublicRecord(item)
  }

  async update(kind: RecordKind, id: string, input: unknown, actor: Principal, requestId: string) {
    const schema = kind === 'EXPENSE' ? expenseSchema.partial().strict() : investmentSchema.partial().strict()
    const parsed = schema.safeParse(input)
    if (!parsed.success) throw badRequest(`${kind === 'EXPENSE' ? 'Expense' : 'Investment'} details are invalid.`)
    if (Object.keys(parsed.data).length === 0) throw badRequest('Provide at least one field to update.')
    if (parsed.data.date !== undefined && !isIsoDate(parsed.data.date)) throw badRequest('Enter a valid record date.')
    const key = { PK: `${kind}#${id}`, SK: 'PROFILE' }
    const current = await this.repository.get<TableItem>(key)
    if (!current) throw notFound(`${kind === 'EXPENSE' ? 'Expense' : 'Investment'} record was not found.`)
    const changes = parsed.data as Record<string, unknown>
    const updatedAt = new Date().toISOString()
    const updated: TableItem = {
      ...current,
      ...changes,
      ...(kind === 'EXPENSE' && changes.agentId === undefined ? { agentId: current.agentId } : {}),
      GSI1PK: `BUSINESS#${runtime.businessId()}#DATE#${String(changes.date ?? current.date)}`,
      GSI1SK: `${kind}#${updatedAt}#${id}`,
      GSI2PK: `BUSINESS#${runtime.businessId()}#${kind}S`,
      GSI2SK: `${String(changes.date ?? current.date)}#${updatedAt}#${id}`,
      updatedAt,
      version: (typeof current.version === 'number' ? current.version : 0) + 1,
    }
    if (kind === 'EXPENSE' && changes.agentId !== undefined) {
      updated.agentId = await this.resolveExpenseAgent(String(changes.agentId), actor)
    }
    const audit = createAuditRecord({
      actorUserId: actor.userId,
      action: `${kind.toLowerCase()}_updated`,
      entityType: kind,
      entityId: id,
      requestId,
      occurredAt: updatedAt,
      metadata: {
        before: JSON.stringify(publicFields(kind, current)),
        after: JSON.stringify(publicFields(kind, updated)),
      },
    })
    try {
      await this.repository.transact({
        TransactItems: [
          { Put: {
            TableName: process.env.TABLE_NAME,
            Item: updated,
            ConditionExpression: '#version = :version',
            ExpressionAttributeNames: { '#version': 'version' },
            ExpressionAttributeValues: { ':version': current.version ?? 0 },
          } },
          { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
        ],
      })
    } catch (error) {
      if (isConditionalFailure(error)) throw conflict('This record changed in another request. Reload and try again.')
      throw error
    }
    return toPublicRecord(updated)
  }

  private async resolveExpenseAgent(agentId: string | undefined, actor: Principal) {
    const selectedId = actor.role === 'STAFF' ? actor.userId : agentId
    if (!selectedId) return undefined
    const staff = await this.repository.get<TableItem>({ PK: `STAFF#${selectedId}`, SK: 'PROFILE' })
    if (!staff || staff.status !== 'ACTIVE') throw badRequest('Select an active agent for this expense.')
    return selectedId
  }
}

function parseDateRange(from: string | undefined, to: string | undefined) {
  if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) {
    throw badRequest('Provide valid from and to dates in YYYY-MM-DD format.')
  }
  if (from > to) throw badRequest('The start date must be on or before the end date.')
  return { from, to }
}

function publicFields(kind: RecordKind, item: TableItem) {
  return kind === 'EXPENSE'
    ? { date: item.date, amountPaise: item.amountPaise, reason: item.reason, comments: item.comments, agentId: item.agentId }
    : { date: item.date, amountPaise: item.amountPaise, investorName: item.investorName, comments: item.comments }
}

function toPublicRecord(item: TableItem) {
  const {
    PK: _pk,
    SK: _sk,
    GSI1PK: _gsi1pk,
    GSI1SK: _gsi1sk,
    GSI2PK: _gsi2pk,
    GSI2SK: _gsi2sk,
    businessId: _businessId,
    ...publicRecord
  } = item
  return publicRecord
}
