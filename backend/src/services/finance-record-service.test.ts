import { describe, expect, it, vi } from 'vitest'
import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb'
import type { TableItem, TableRepository } from '../repositories/table-repository.js'
import type { Principal } from './auth-service.js'

vi.mock('../config/runtime.js', () => ({
  runtime: {
    businessId: () => 'test-business',
    jwtSecret: async () => new Uint8Array(32).fill(5),
  },
}))

import { FinanceRecordService } from './finance-record-service.js'

describe('finance record service', () => {
  it('creates agent expenses assigned to the signed-in agent and writes an audit event atomically', async () => {
    const records = new Map<string, TableItem>([
      ['STAFF#staff_1|PROFILE', {
        PK: 'STAFF#staff_1', SK: 'PROFILE', staffId: 'staff_1', status: 'ACTIVE',
      }],
    ])
    const get = vi.fn(async (key: Pick<TableItem, 'PK' | 'SK'>) => records.get(`${key.PK}|${key.SK}`))
    const transact = vi.fn(async (_input: TransactWriteCommandInput) => undefined)
    const repository = { get, transact } as unknown as TableRepository
    const service = new FinanceRecordService(repository)
    const actor: Principal = { userId: 'staff_1', role: 'STAFF', passwordChangeRequired: false }

    await expect(service.create('EXPENSE', {
      date: '2026-10-27',
      amountPaise: 125_50,
      reason: 'Travel',
      agentId: 'another-agent',
    }, actor, 'request_1')).resolves.toMatchObject({ date: '2026-10-27', agentId: 'staff_1' })

    const actions = transact.mock.calls[0]?.[0].TransactItems ?? []
    expect(actions).toHaveLength(2)
    expect(actions[0]?.Put?.Item?.GSI2PK).toBe('BUSINESS#test-business#EXPENSES')
    expect(actions[1]?.Put?.Item?.action).toBe('expense_created')
  })

  it('rejects invalid date ranges before querying DynamoDB', async () => {
    const query = vi.fn()
    const repository = { query } as unknown as TableRepository
    const service = new FinanceRecordService(repository)

    await expect(service.list('EXPENSE', { from: '2026-11-01', to: '2026-10-01' }))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(query).not.toHaveBeenCalled()
  })
})
