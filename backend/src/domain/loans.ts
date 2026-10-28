export type LoanType = 'DAILY' | 'WEEKLY' | 'MONTHLY'

export interface LoanBalance {
  type: LoanType
  status: 'ACTIVE' | 'PAID'
  targetPaise: number
  collectedPaise: number
  principalPaise: number
  monthlyInterestPaise: number
  interestCollectedPaise: number
  principalCollectedPaise: number
  disbursedOn: string
}

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

export function calculateOutstandingPaise(loan: LoanBalance, asOfDate: string) {
  if (loan.status === 'PAID') return 0
  if (loan.type !== 'MONTHLY') return Math.max(0, loan.targetPaise - loan.collectedPaise)

  const accruedInterest = completedMonthlyCycles(loan.disbursedOn, asOfDate) * loan.monthlyInterestPaise
  const unpaidInterest = Math.max(0, accruedInterest - loan.interestCollectedPaise)
  const remainingPrincipal = Math.max(0, loan.principalPaise - loan.principalCollectedPaise)
  return unpaidInterest + remainingPrincipal
}

export function allocatePayment(loan: LoanBalance, amountPaise: number, asOfDate: string): PaymentAllocation {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new Error('Payment must be a positive whole number of paise.')
  }
  if (amountPaise > calculateOutstandingPaise(loan, asOfDate)) {
    throw new Error('Payment cannot exceed the remaining loan balance.')
  }
  if (loan.type !== 'MONTHLY') return { interestPaise: 0, principalPaise: 0 }

  const accruedInterest = completedMonthlyCycles(loan.disbursedOn, asOfDate) * loan.monthlyInterestPaise
  const unpaidInterest = Math.max(0, accruedInterest - loan.interestCollectedPaise)
  const interestPaise = Math.min(amountPaise, unpaidInterest)
  return { interestPaise, principalPaise: amountPaise - interestPaise }
}
