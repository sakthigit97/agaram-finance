import { badRequest } from '../errors/app-error.js'
import { decodeCursor, encodeCursor } from './cursors.js'

export function parsePageSize(value: string | undefined) {
  if (value === undefined) return 25
  if (!/^\d+$/.test(value)) throw badRequest('limit must be an integer from 1 to 100.')
  const limit = Number(value)
  if (limit < 1 || limit > 100) throw badRequest('limit must be an integer from 1 to 100.')
  return limit
}

export function cursorForQuery(
  cursor: string | undefined,
  secret: Uint8Array,
  partitionKeyName: string,
  partitionValue: string,
) {
  const key = decodeCursor(cursor, secret)
  if (key && key[partitionKeyName] !== partitionValue) {
    throw badRequest('Pagination cursor does not match this query.')
  }
  return key
}

export function nextCursor(
  key: Record<string, unknown> | undefined,
  secret: Uint8Array,
) {
  return key ? encodeCursor(key, secret) : undefined
}
