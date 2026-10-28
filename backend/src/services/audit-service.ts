import { createId } from '../domain/ids.js'
import { runtime } from '../config/runtime.js'
import type { TableItem } from '../repositories/table-repository.js'
import { cursorForQuery, nextCursor, parsePageSize } from '../domain/pagination.js'
import { badRequest } from '../errors/app-error.js'
import { TableRepository } from '../repositories/table-repository.js'

export function createAuditRecord(input: {
  actorUserId: string
  action: string
  entityType: string
  entityId: string
  requestId: string
  metadata?: Record<string, string | number | boolean>
  occurredAt?: string
}): TableItem {
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  return {
    PK: `ENTITY#${input.entityType}#${input.entityId}`,
    SK: `EVENT#${occurredAt}#${createId('evt')}`,
    GSI2PK: `BUSINESS#${runtime.businessId()}#AUDIT`,
    GSI2SK: `${occurredAt}#${createId('evt')}`,
    entityType: 'AUDIT_EVENT',
    businessId: runtime.businessId(),
    actorUserId: input.actorUserId,
    action: input.action,
    entityId: input.entityId,
    requestId: input.requestId,
    occurredAt,
    metadata: input.metadata ?? {},
  }
}

export class AuditService {
  constructor(private readonly repository: TableRepository) {}

  async list(query: Record<string, string | undefined>) {
    const limit = parsePageSize(query.limit)
    const secret = await runtime.jwtSecret()
    if (query.entityType || query.entityId) {
      if (!query.entityType || !query.entityId || !/^[A-Z_]{1,32}$/.test(query.entityType)) {
        throw badRequest('entityType and entityId must both be provided for entity audit history.')
      }
      const partition = `ENTITY#${query.entityType}#${query.entityId}`
      const result = await this.repository.query({
        KeyConditionExpression: 'PK = :partition AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':partition': partition, ':prefix': 'EVENT#' },
        Limit: limit,
        ScanIndexForward: false,
        ExclusiveStartKey: cursorForQuery(query.cursor, secret, 'PK', partition),
      })
      return {
        items: (result.Items ?? []).map(toPublicAudit),
        nextCursor: nextCursor(result.LastEvaluatedKey, secret),
      }
    }
    const partition = `BUSINESS#${runtime.businessId()}#AUDIT`
    const result = await this.repository.query({
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :partition',
      ExpressionAttributeValues: { ':partition': partition },
      Limit: limit,
      ScanIndexForward: false,
      ExclusiveStartKey: cursorForQuery(query.cursor, secret, 'GSI2PK', partition),
    })
    return {
      items: (result.Items ?? []).map(toPublicAudit),
      nextCursor: nextCursor(result.LastEvaluatedKey, secret),
    }
  }
}

function toPublicAudit(item: Record<string, unknown>) {
  const {
    PK: _pk,
    SK: _sk,
    GSI2PK: _gsi2pk,
    GSI2SK: _gsi2sk,
    entityType: _type,
    businessId: _businessId,
    ...publicRecord
  } = item
  return publicRecord
}
