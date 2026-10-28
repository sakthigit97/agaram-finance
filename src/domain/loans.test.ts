import { describe, expect, it } from 'vitest'
import { allocatePayment, completedMonthlyCycles, getLoanOutstandingPaise } from './loans'
import type { Loan } from '../types/finance'

const monthlyLoan: Loan = {
  id: 'LN-1',
  customerId: 'CUS-1',
  type: 'Monthly',
  principalPaise: 10_000_00,
  interestPaise: 3_000_00,
  feePaise: 0,
  targetPaise: 10_000_00,
  collectedPaise: 3_000_00,
  interestCollectedPaise: 3_000_00,
  principalCollectedPaise: 0,
  disbursedOn: '2026-08-31',
  status: 'Active',
}

describe('monthly finance calculations', () => {
  it('charges at complete anniversaries and clamps month-end anniversaries', () => {
    expect(completedMonthlyCycles('2026-08-31', '2026-09-29')).toBe(0)
    expect(completedMonthlyCycles('2026-08-31', '2026-09-30')).toBe(1)
    expect(completedMonthlyCycles('2026-08-31', '2026-10-31')).toBe(2)
  })

  it('adds fixed monthly interest and allocates it before principal', () => {
    expect(getLoanOutstandingPaise(monthlyLoan, '2026-10-31')).toBe(10_000_00 + 3_000_00)
    expect(allocatePayment(monthlyLoan, 5_000_00, '2026-10-31')).toEqual({
      interestPaise: 3_000_00,
      principalPaise: 2_000_00,
    })
  })

  it('rejects a payment greater than the current outstanding balance', () => {
    expect(() => allocatePayment(monthlyLoan, 14_000_01, '2026-10-31')).toThrow(
      'Payment cannot exceed the remaining loan balance.',
    )
  })
})
