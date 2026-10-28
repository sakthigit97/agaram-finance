import { hash } from 'bcryptjs'
import { jwtVerify } from 'jose'
import { describe, expect, it, vi } from 'vitest'
import { phoneLookupKey } from '../domain/phone.js'
import type { TableItem, TableRepository } from '../repositories/table-repository.js'
import { AuthService } from './auth-service.js'

const { secret } = vi.hoisted(() => ({ secret: new Uint8Array(32).fill(9) }))

vi.mock('../config/runtime.js', () => ({
  runtime: {
    businessId: () => 'test-business',
    jwtSecret: async () => secret,
    phoneLookupSecret: async () => secret,
  },
}))

describe('authentication sessions', () => {
  it('creates recognizable, unique one-time credentials for each account type', () => {
    const auth = new AuthService({} as TableRepository)
    const customerPassword = auth.createTemporaryPassword('CUSTOMER')
    const agentPassword = auth.createTemporaryPassword('STAFF')

    expect(customerPassword).toMatch(/^customer@Agaram-[A-Za-z0-9_-]{16}$/)
    expect(agentPassword).toMatch(/^agent@Agaram-[A-Za-z0-9_-]{16}$/)
    expect(customerPassword).not.toBe(agentPassword)
  })

  it('issues a bearer token that expires after 24 hours', async () => {
    const phone = '9876543210'
    const password = 'safe-test-password'
    const passwordHash = await hash(password, 4)
    const mappingKey = `PHONE#${phoneLookupKey(phone, secret)}`
    const records = new Map<string, TableItem>([
      [`${mappingKey}|USER`, { PK: mappingKey, SK: 'USER', userId: 'staff_1' }],
      ['USER#staff_1|PROFILE', {
        PK: 'USER#staff_1',
        SK: 'PROFILE',
        entityType: 'USER',
        userId: 'staff_1',
        phone,
        name: 'Test Agent',
        role: 'STAFF',
        passwordHash,
        status: 'ACTIVE',
        passwordChangeRequired: false,
        version: 1,
      }],
    ])
    const repository = {
      get: async (key: Pick<TableItem, 'PK' | 'SK'>) => records.get(`${key.PK}|${key.SK}`),
      update: async () => undefined,
    } as unknown as TableRepository
    const auth = new AuthService(repository)

    const result = await auth.authenticate(phone, password, '127.0.0.1')
    const { payload } = await jwtVerify(result.accessToken, secret, { algorithms: ['HS256'] })

    expect(result.expiresIn).toBe(86_400)
    expect(payload.exp! - payload.iat!).toBe(86_400)
  })
})
