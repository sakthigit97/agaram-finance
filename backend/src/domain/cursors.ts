import { createHmac, timingSafeEqual } from 'node:crypto'
import { badRequest } from '../errors/app-error.js'

export function encodeCursor(key: Record<string, unknown>, secret: Uint8Array) {
  const value = Buffer.from(JSON.stringify(key)).toString('base64url')
  const signature = createHmac('sha256', secret).update(value).digest('base64url')
  return `${value}.${signature}`
}

export function decodeCursor(cursor: string | undefined, secret: Uint8Array) {
  if (!cursor) return undefined
  const [value, suppliedSignature, extra] = cursor.split('.')
  if (!value || !suppliedSignature || extra) throw badRequest('Pagination cursor is invalid.')
  const expected = createHmac('sha256', secret).update(value).digest()
  let actual: Buffer
  try {
    actual = Buffer.from(suppliedSignature, 'base64url')
  } catch {
    throw badRequest('Pagination cursor is invalid.')
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw badRequest('Pagination cursor is invalid.')
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid key.')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw badRequest('Pagination cursor is invalid.')
  }
}
