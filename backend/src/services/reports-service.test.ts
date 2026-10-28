import { describe, expect, it, vi } from 'vitest'
import type { TableItem, TableRepository } from '../repositories/table-repository.js'

vi.mock('../config/runtime.js', () => ({
  runtime: { businessId: () => 'test-business' },
}))

import { ReportsService } from './reports-service.js'

describe('financial reports', () => {
  it('nets reversals and separates interest, principal, expenses, and investor capital', async () => {
    const query = vi.fn(async (input: Record<string, unknown>) => {
      const values = input.ExpressionAttributeValues as Record<string, string>
      if (input.IndexName === 'GSI1') {
        if (values[':partition']?.endsWith('#2026-10-01')) {
          return { Items: [{
            PK: 'LOAN#loan_1', SK: 'PAYMENT#2026-10-01#TRNS001',
            entryType: 'PAYMENT', amountPaise: 10_000, interestComponentPaise: 1_000, principalComponentPaise: 9_000,
          } as TableItem] }
        }
        return { Items: [{
          PK: 'LOAN#loan_1', SK: 'PAYMENT#2026-10-02#TRNS002',
          entryType: 'REVERSAL', amountPaise: 2_000, interestComponentPaise: 200, principalComponentPaise: 1_800,
        } as TableItem] }
      }
      if (values[':partition']?.endsWith('#EXPENSES')) {
        return { Items: [{ PK: 'EXPENSE#expense_1', SK: 'PROFILE', amountPaise: 300 } as TableItem] }
      }
      if (values[':partition']?.endsWith('#LOANS')) {
        return { Items: [{
          PK: 'LOAN#LOAN001', SK: 'PROFILE', entityType: 'LOAN', loanId: 'LOAN001', status: 'ACTIVE',
          disbursedOn: '2026-10-01', disbursedPaise: 9_000, principalPaise: 10_000,
          collectedPaise: 8_000, interestCollectedPaise: 800, principalCollectedPaise: 7_200,
          upfrontInterestPaise: 1_000, bookFeePaise: 0,
        } as TableItem] }
      }
      return { Items: [{ PK: 'INVESTMENT#investment_1', SK: 'PROFILE', amountPaise: 5_000 } as TableItem] }
    })
    const repository = { query } as unknown as TableRepository
    const service = new ReportsService(repository)

    await expect(service.summary('2026-10-01', '2026-10-02')).resolves.toMatchObject({
      collectionsPaise: 8_000,
      interestEarnedPaise: 800,
      principalRepaidPaise: 7_200,
      paymentCount: 1,
      expensesPaise: 300,
      expenseCount: 1,
      investmentsPaise: 5_000,
      investmentCount: 1,
      netEarningsPaise: 500,
      netCashAfterExpensesPaise: 7_700,
      disbursedPaise: 9_000,
      netCashMovementPaise: 3_700,
      portfolio: expect.objectContaining({
        outstandingPrincipalPaise: 2_800,
        totalEarningsPaise: 1_500,
        calculatedCashBalancePaise: 3_700,
      }),
      investorCapitalIsNotRevenue: true,
    })
  })

  it('bounds reports to a year so range queries cannot become unbounded', async () => {
    const query = vi.fn()
    const repository = { query } as unknown as TableRepository
    const service = new ReportsService(repository)

    await expect(service.summary('2025-01-01', '2026-10-01')).rejects.toMatchObject({ statusCode: 400 })
    expect(query).not.toHaveBeenCalled()
  })
})
