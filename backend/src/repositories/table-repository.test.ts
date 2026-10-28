import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { describe, expect, it, vi } from 'vitest'
import { TableRepository } from './table-repository.js'

describe('business ID allocation', () => {
  it('uses a scoped atomic counter and formats readable IDs by entity', async () => {
    const send = vi.fn(async (_command: unknown) => ({ Attributes: { sequence: 1 } }))
    const repository = new TableRepository({ send } as never, 'test-table')

    await expect(repository.nextBusinessId('business-1', 'CUSTOMER')).resolves.toBe('CUS001')
    await expect(repository.nextBusinessId('business-1', 'LOAN')).resolves.toBe('LOAN001')
    await expect(repository.nextBusinessId('business-1', 'TRANSACTION')).resolves.toBe('TRNS001')

    expect(send).toHaveBeenCalledTimes(3)
    for (const [command] of send.mock.calls) {
      expect(command).toBeInstanceOf(UpdateCommand)
      if (command instanceof UpdateCommand) {
        expect(command.input.TableName).toBe('test-table')
        expect(command.input.UpdateExpression).toBe('ADD #sequence :one')
        expect(command.input.ExpressionAttributeValues).toEqual({ ':one': 1 })
      }
    }
    expect(send.mock.calls.map(([command]) => (
      command instanceof UpdateCommand ? command.input.Key : undefined
    ))).toEqual([
      { PK: 'ID_COUNTER#business-1', SK: 'CUSTOMER' },
      { PK: 'ID_COUNTER#business-1', SK: 'LOAN' },
      { PK: 'ID_COUNTER#business-1', SK: 'TRANSACTION' },
    ])
  })

  it('pads sequence numbers to at least three digits without truncation', async () => {
    const send = vi.fn(async (_command: unknown) => ({ Attributes: { sequence: 1234 } }))
    const repository = new TableRepository({ send } as never, 'test-table')

    await expect(repository.nextBusinessId('business-1', 'CUSTOMER')).resolves.toBe('CUS1234')
  })
})
