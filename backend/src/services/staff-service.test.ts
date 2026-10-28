import { describe, expect, it, vi } from 'vitest'
import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb'
import { phoneLookupKey } from '../domain/phone.js'
import type { TableItem, TableRepository } from '../repositories/table-repository.js'
import type { AuthService, Principal } from './auth-service.js'

const { secret } = vi.hoisted(() => ({ secret: new Uint8Array(32).fill(7) }))

vi.mock('../config/runtime.js', () => ({
  runtime: {
    businessId: () => 'test-business',
    jwtSecret: async () => secret,
    phoneLookupSecret: async () => secret,
  },
}))

import { StaffService } from './staff-service.js'

describe('staff profile updates', () => {
  it('updates the login profile, moves the unique phone mapping, and writes an audit event atomically', async () => {
    const oldPhone = '9876543210'
    const newPhone = '9123456789'
    const records = new Map<string, TableItem>([
      [`STAFF#staff_1|PROFILE`, {
        PK: 'STAFF#staff_1', SK: 'PROFILE', staffId: 'staff_1', userId: 'staff_1',
        name: 'Old Name', phone: oldPhone, version: 1,
      }],
      [`USER#staff_1|PROFILE`, {
        PK: 'USER#staff_1', SK: 'PROFILE', userId: 'staff_1', role: 'STAFF',
        name: 'Old Name', phone: oldPhone, version: 2,
      }],
      [`PHONE#${phoneLookupKey(oldPhone, secret)}|USER`, {
        PK: `PHONE#${phoneLookupKey(oldPhone, secret)}`, SK: 'USER', userId: 'staff_1',
      }],
    ])
    const get = vi.fn(async (key: Pick<TableItem, 'PK' | 'SK'>) => records.get(`${key.PK}|${key.SK}`))
    const transact = vi.fn(async (_input: TransactWriteCommandInput) => undefined)
    const repository = { get, transact } as unknown as TableRepository
    const service = new StaffService(repository, {} as AuthService, { getCustomFieldDefinitions: async () => [] } as never)
    const actor: Principal = { userId: 'admin_1', role: 'ADMIN', passwordChangeRequired: false }

    await expect(service.update('staff_1', { name: 'Updated Name', phone: newPhone }, actor, 'request_1'))
      .resolves.toMatchObject({ staffId: 'staff_1', name: 'Updated Name', phone: newPhone })

    expect(transact).toHaveBeenCalledOnce()
    const actions = transact.mock.calls[0]?.[0].TransactItems ?? []
    expect(actions).toHaveLength(5)
    expect(actions.some((action) => action.Put?.Item?.PK === `PHONE#${phoneLookupKey(newPhone, secret)}`)).toBe(true)
    expect(actions.some((action) => action.Delete?.Key?.PK === `PHONE#${phoneLookupKey(oldPhone, secret)}`)).toBe(true)
    expect(actions.some((action) => action.Put?.Item?.action === 'staff_updated')).toBe(true)
    expect(actions[1]?.Update?.ExpressionAttributeValues?.[':userVersion']).toBe(2)
  })

  it('rejects a phone number already mapped to a different account without writing', async () => {
    const phone = '9876543210'
    const mappedPhone = '9123456789'
    const records = new Map<string, TableItem>([
      [`STAFF#staff_1|PROFILE`, {
        PK: 'STAFF#staff_1', SK: 'PROFILE', staffId: 'staff_1', userId: 'staff_1',
        name: 'Agent', phone, version: 1,
      }],
      [`USER#staff_1|PROFILE`, {
        PK: 'USER#staff_1', SK: 'PROFILE', userId: 'staff_1', role: 'STAFF', version: 1,
      }],
      [`PHONE#${phoneLookupKey(mappedPhone, secret)}|USER`, {
        PK: `PHONE#${phoneLookupKey(mappedPhone, secret)}`, SK: 'USER', userId: 'customer_1',
      }],
    ])
    const get = vi.fn(async (key: Pick<TableItem, 'PK' | 'SK'>) => records.get(`${key.PK}|${key.SK}`))
    const transact = vi.fn(async (_input: TransactWriteCommandInput) => undefined)
    const repository = { get, transact } as unknown as TableRepository
    const service = new StaffService(repository, {} as AuthService, { getCustomFieldDefinitions: async () => [] } as never)
    const actor: Principal = { userId: 'admin_1', role: 'ADMIN', passwordChangeRequired: false }

    await expect(service.update('staff_1', { phone: mappedPhone }, actor, 'request_2'))
      .rejects.toMatchObject({ statusCode: 409, code: 'PHONE_ALREADY_EXISTS' })
    expect(transact).not.toHaveBeenCalled()
  })
})
