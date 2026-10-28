import { addCalendarMonths, isIsoDate } from './dates.js'
import type { LoanRecord } from '../services/loan-service.js'
import { badRequest } from '../errors/app-error.js'

export interface PaymentAllocation {
  interestPaise: number
  principalPaise: number
  targetPaise: number
}

export function completedMonthlyCycles(startDate: string, asOfDate: string) {
  if (!isIsoDate(startDate) || !isIsoDate(asOfDate) || asOfDate < startDate) return 0
  let cycles = 0
  while (addCalendarMonths(startDate, cycles + 1) <= asOfDate) cycles += 1
  return cycles
}

export function outstandingPaise(loan: LoanRecord, asOfDate: string) {
  if (loan.status === 'PAID') return 0
  if (loan.type !== 'MONTHLY') return Math.max(0, loan.targetPaise - loan.collectedPaise)
  const interestThrough = loan.principalPaidOffOn && loan.principalPaidOffOn < asOfDate
    ? loan.principalPaidOffOn
    : asOfDate
  const accruedInterest = completedMonthlyCycles(loan.disbursedOn, interestThrough) * loan.monthlyInterestPaise
  const unpaidInterest = Math.max(0, accruedInterest - loan.interestCollectedPaise)
  const unpaidPrincipal = Math.max(0, loan.principalPaise - loan.principalCollectedPaise)
  return unpaidInterest + unpaidPrincipal
}

export function allocatePayment(loan: LoanRecord, amountPaise: number, asOfDate: string): PaymentAllocation {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw badRequest('Payment amount must be a positive integer number of paise.')
  }
  if (amountPaise > outstandingPaise(loan, asOfDate)) {
    throw badRequest('Payment exceeds the outstanding loan balance.', 'OVERPAYMENT')
  }
  if (loan.type !== 'MONTHLY') {
    return { interestPaise: 0, principalPaise: 0, targetPaise: amountPaise }
  }
  const interestThrough = loan.principalPaidOffOn && loan.principalPaidOffOn < asOfDate
    ? loan.principalPaidOffOn
    : asOfDate
  const accruedInterest = completedMonthlyCycles(loan.disbursedOn, interestThrough) * loan.monthlyInterestPaise
  const interestPaise = Math.min(amountPaise, Math.max(0, accruedInterest - loan.interestCollectedPaise))
  return {
    interestPaise,
    principalPaise: amountPaise - interestPaise,
    targetPaise: 0,
  }
}
