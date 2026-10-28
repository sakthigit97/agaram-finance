import { describe, expect, it } from 'vitest'
import { allocatePayment, calculateOutstandingPaise, completedMonthlyCycles } from './loans.js'
import type { LoanBalance } from './loans.js'

const loan: LoanBalance = {
  type: 'MONTHLY',
  status: 'ACTIVE',
  targetPaise: 1_000_000,
  collectedPaise: 300_000,
  principalPaise: 1_000_000,
  monthlyInterestPaise: 300_000,
  interestCollectedPaise: 300_000,
  principalCollectedPaise: 0,
  disbursedOn: '2026-08-31',
}

describe('loan balances', () => {
  it('uses complete monthly cycles and month-end anniversary dates', () => {
    expect(completedMonthlyCycles('2026-08-31', '2026-09-29')).toBe(0)
    expect(completedMonthlyCycles('2026-08-31', '2026-09-30')).toBe(1)
    expect(completedMonthlyCycles('2026-08-31', '2026-10-31')).toBe(2)
  })

  it('applies fixed monthly interest before principal', () => {
    expect(calculateOutstandingPaise(loan, '2026-10-31')).toBe(1_300_000)
    expect(allocatePayment(loan, 500_000, '2026-10-31')).toEqual({
      interestPaise: 300_000,
      principalPaise: 200_000,
    })
  })

  it('rejects payments that exceed the balance', () => {
    expect(() => allocatePayment(loan, 1_400_001, '2026-10-31')).toThrow(
      'Payment cannot exceed the remaining loan balance.',
    )
  })
})
