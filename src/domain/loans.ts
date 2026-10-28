import type { Loan } from '../types/finance'

export interface PaymentAllocation {
  interestPaise: number
  principalPaise: number
}

export function completedMonthlyCycles(startDate: string, asOfDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${asOfDate}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0

  let cycles = 0
  let year = start.getUTCFullYear()
  let month = start.getUTCMonth()
  const startDay = start.getUTCDate()

  while (true) {
    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const dueDate = new Date(Date.UTC(year, month, Math.min(startDay, lastDay)))
    if (dueDate > end) return cycles
    cycles += 1
  }
}

export function getLoanOutstandingPaise(loan: Loan, asOfDate: string) {
  if (loan.status === 'Paid') return 0
  if (loan.type !== 'Monthly') return Math.max(0, loan.targetPaise - loan.collectedPaise)

  const accruedInterestPaise = completedMonthlyCycles(loan.disbursedOn, asOfDate) * loan.interestPaise
  const unpaidInterestPaise = Math.max(0, accruedInterestPaise - loan.interestCollectedPaise)
  const remainingPrincipalPaise = Math.max(0, loan.principalPaise - loan.principalCollectedPaise)
  return unpaidInterestPaise + remainingPrincipalPaise
}

export function allocatePayment(loan: Loan, amountPaise: number, asOfDate: string): PaymentAllocation {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new Error('Payment must be a positive whole number of paise.')
  }
  if (amountPaise > getLoanOutstandingPaise(loan, asOfDate)) {
    throw new Error('Payment cannot exceed the remaining loan balance.')
  }
  if (loan.type !== 'Monthly') return { interestPaise: 0, principalPaise: 0 }

  const accruedInterestPaise = completedMonthlyCycles(loan.disbursedOn, asOfDate) * loan.interestPaise
  const unpaidInterestPaise = Math.max(0, accruedInterestPaise - loan.interestCollectedPaise)
  const interestPaise = Math.min(amountPaise, unpaidInterestPaise)
  return { interestPaise, principalPaise: amountPaise - interestPaise }
}
