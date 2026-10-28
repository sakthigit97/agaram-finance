import { describe, expect, it } from 'vitest'
import { addCalendarMonths } from './dates.js'
import { allocatePayment, completedMonthlyCycles, outstandingPaise } from './loan-math.js'
import type { LoanRecord } from '../services/loan-service.js'

const monthlyLoan = {
  entityType: 'LOAN',
  PK: 'LOAN#loan_1',
  SK: 'PROFILE',
  loanId: 'loan_1',
  customerId: 'cus_1',
  type: 'MONTHLY',
  principalPaise: 10_000_00,
  upfrontInterestPaise: 0,
  bookFeePaise: 0,
  monthlyInterestPaise: 3_000_00,
  disbursedPaise: 10_000_00,
  targetPaise: 10_000_00,
  collectedPaise: 3_000_00,
  interestCollectedPaise: 3_000_00,
  principalCollectedPaise: 0,
  status: 'ACTIVE',
  version: 1,
  disbursedOn: '2026-08-31',
  customFields: {},
  customFieldDefinitions: [],
} satisfies LoanRecord

describe('monthly loan rules', () => {
  it('uses the first monthly anniversary and clamps short months', () => {
    expect(addCalendarMonths('2026-08-31', 1)).toBe('2026-09-30')
    expect(completedMonthlyCycles('2026-08-31', '2026-09-29')).toBe(0)
    expect(completedMonthlyCycles('2026-08-31', '2026-09-30')).toBe(1)
    expect(completedMonthlyCycles('2026-08-31', '2026-10-31')).toBe(2)
  })

  it('adds the fixed charge and allocates interest before principal', () => {
    expect(outstandingPaise(monthlyLoan, '2026-10-31')).toBe(1_300_000)
    expect(allocatePayment(monthlyLoan, 500_000, '2026-10-31')).toEqual({
      interestPaise: 300_000,
      principalPaise: 200_000,
      targetPaise: 0,
    })
  })

  it('rejects overpayment and treats non-monthly collections as target balance payments', () => {
    expect(() => allocatePayment(monthlyLoan, 1_400_001, '2026-10-31')).toThrow(
      'Payment exceeds the outstanding loan balance.',
    )
    expect(allocatePayment({
      ...monthlyLoan,
      type: 'DAILY',
      targetPaise: 500_000,
      collectedPaise: 100_000,
      status: 'ACTIVE',
    }, 40_000, '2026-10-31')).toEqual({
      interestPaise: 0,
      principalPaise: 0,
      targetPaise: 40_000,
    })
  })
})
