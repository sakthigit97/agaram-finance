import { describe, expect, it } from 'vitest'
import { handler } from './health.js'

describe('health handler', () => {
  it('returns a small successful readiness response', async () => {
    const response = await handler()
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body ?? '')).toEqual({
      status: 'ok',
      service: 'agaram-finance-api',
    })
  })
})
