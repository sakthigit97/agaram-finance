import { runtime } from '../config/runtime.js'
import { isIsoDate } from '../domain/dates.js'
import { badRequest } from '../errors/app-error.js'
import { TableRepository, type TableItem } from '../repositories/table-repository.js'
import type { LoanRecord } from './loan-service.js'

interface PaymentTotals { collectionsPaise: number; interestEarnedPaise: number; principalRepaidPaise: number; paymentCount: number }
interface DailyTotals extends PaymentTotals { date: string; expensesPaise: number; investmentsPaise: number; disbursedPaise: number }

export class ReportsService {
  constructor(private readonly repository: TableRepository) {}

  async summary(from: string | undefined, to: string | undefined) {
    const dates = reportDates(from, to)
    const start = dates[0]!
    const end = dates.at(-1)!
    const daily = new Map(dates.map((date) => [date, emptyDaily(date)]))
    const [payments, expenses, investments, loans] = await Promise.all([
      this.paymentTotals(dates, daily), this.recordTotals('EXPENSE', start, end, daily),
      this.recordTotals('INVESTMENT', start, end, daily), this.allLoans(),
    ])
    let disbursedPaise = 0
    let loansDisbursed = 0
    for (const loan of loans) {
      if (loan.disbursedOn >= start && loan.disbursedOn <= end) {
        const amount = numberOrZero(loan.disbursedPaise)
        disbursedPaise += amount; loansDisbursed += 1
        daily.get(loan.disbursedOn)!.disbursedPaise += amount
      }
    }
    return {
      from: start, to: end, ...payments,
      expensesPaise: expenses.amountPaise, expenseCount: expenses.count,
      investmentsPaise: investments.amountPaise, investmentCount: investments.count,
      disbursedPaise, loansDisbursed,
      netEarningsPaise: payments.interestEarnedPaise - expenses.amountPaise,
      netCashMovementPaise: investments.amountPaise + payments.collectionsPaise - disbursedPaise - expenses.amountPaise,
      netCashAfterExpensesPaise: payments.collectionsPaise - expenses.amountPaise,
      daily: [...daily.values()].map((item) => ({ ...item, netCashMovementPaise: item.investmentsPaise + item.collectionsPaise - item.disbursedPaise - item.expensesPaise })),
      portfolio: await this.portfolioSnapshot(loans),
      investorCapitalIsNotRevenue: true as const,
    }
  }

  private async portfolioSnapshot(loans: LoanRecord[]) {
    const [investments, expenses] = await Promise.all([this.allRecordTotals('INVESTMENT'), this.allRecordTotals('EXPENSE')])
    const totals = loans.reduce((result, loan) => ({
      loanCount: result.loanCount + 1,
      activeLoanCount: result.activeLoanCount + (loan.status === 'ACTIVE' ? 1 : 0),
      totalDisbursedPaise: result.totalDisbursedPaise + numberOrZero(loan.disbursedPaise),
      totalCollectionsPaise: result.totalCollectionsPaise + numberOrZero(loan.collectedPaise),
      totalInterestCollectedPaise: result.totalInterestCollectedPaise + numberOrZero(loan.interestCollectedPaise),
      totalPrincipalRepaidPaise: result.totalPrincipalRepaidPaise + numberOrZero(loan.principalCollectedPaise),
      outstandingPrincipalPaise: result.outstandingPrincipalPaise + Math.max(0, numberOrZero(loan.principalPaise) - numberOrZero(loan.principalCollectedPaise)),
      upfrontInterestPaise: result.upfrontInterestPaise + numberOrZero(loan.upfrontInterestPaise),
      bookFeesPaise: result.bookFeesPaise + numberOrZero(loan.bookFeePaise),
    }), { loanCount: 0, activeLoanCount: 0, totalDisbursedPaise: 0, totalCollectionsPaise: 0, totalInterestCollectedPaise: 0, totalPrincipalRepaidPaise: 0, outstandingPrincipalPaise: 0, upfrontInterestPaise: 0, bookFeesPaise: 0 })
    return {
      ...totals, totalInvestorCapitalPaise: investments.amountPaise, totalExpensesPaise: expenses.amountPaise,
      totalInvestmentCount: investments.count, totalExpenseCount: expenses.count,
      totalEarningsPaise: totals.totalInterestCollectedPaise + totals.upfrontInterestPaise + totals.bookFeesPaise - expenses.amountPaise,
      calculatedCashBalancePaise: investments.amountPaise + totals.totalCollectionsPaise - totals.totalDisbursedPaise - expenses.amountPaise,
    }
  }

  private async paymentTotals(dates: string[], daily: Map<string, DailyTotals>): Promise<PaymentTotals> {
    const totals = emptyPayments()
    let nextDateIndex = 0
    await Promise.all(Array.from({ length: Math.min(16, dates.length) }, async () => {
      while (nextDateIndex < dates.length) {
        const date = dates[nextDateIndex++]
        if (!date) return
        const current = daily.get(date)!
        const dateTotals = await this.paymentTotalsForDate(date)
        Object.assign(current, addPayments(current, dateTotals))
        Object.assign(totals, addPayments(totals, dateTotals))
      }
    }))
    return totals
  }

  private async paymentTotalsForDate(date: string): Promise<PaymentTotals> {
    const partition = `BUSINESS#${runtime.businessId()}#DATE#${date}`
    let exclusiveStartKey: Record<string, unknown> | undefined
    const totals = emptyPayments()
    do {
      const result = await this.repository.query({ IndexName: 'GSI1', KeyConditionExpression: 'GSI1PK = :partition AND begins_with(GSI1SK, :prefix)', ExpressionAttributeValues: { ':partition': partition, ':prefix': 'LEDGER#' }, Limit: 100, ExclusiveStartKey: exclusiveStartKey })
      for (const entry of (result.Items ?? []) as TableItem[]) {
        const sign = entry.entryType === 'REVERSAL' ? -1 : 1
        totals.collectionsPaise += sign * numberOrZero(entry.amountPaise)
        totals.interestEarnedPaise += sign * numberOrZero(entry.interestComponentPaise)
        totals.principalRepaidPaise += sign * numberOrZero(entry.principalComponentPaise)
        if (entry.entryType === 'PAYMENT') totals.paymentCount += 1
      }
      exclusiveStartKey = result.LastEvaluatedKey
    } while (exclusiveStartKey)
    return totals
  }

  private async recordTotals(kind: 'EXPENSE' | 'INVESTMENT', from: string, to: string, daily: Map<string, DailyTotals>) {
    const totals = { amountPaise: 0, count: 0 }
    await this.forEachRecord(kind, from, to, (item) => {
      const amount = numberOrZero(item.amountPaise); totals.amountPaise += amount; totals.count += 1
      const day = daily.get(String(item.date))
      if (day) day[kind === 'EXPENSE' ? 'expensesPaise' : 'investmentsPaise'] += amount
    })
    return totals
  }

  private async allRecordTotals(kind: 'EXPENSE' | 'INVESTMENT') {
    const totals = { amountPaise: 0, count: 0 }
    await this.forEachRecord(kind, undefined, undefined, (item) => { totals.amountPaise += numberOrZero(item.amountPaise); totals.count += 1 })
    return totals
  }

  private async allLoans() {
    const loans: LoanRecord[] = []
    let exclusiveStartKey: Record<string, unknown> | undefined
    do {
      const result = await this.repository.query({ IndexName: 'GSI2', KeyConditionExpression: 'GSI2PK = :partition', ExpressionAttributeValues: { ':partition': `BUSINESS#${runtime.businessId()}#LOANS` }, Limit: 100, ExclusiveStartKey: exclusiveStartKey })
      loans.push(...(result.Items ?? []) as LoanRecord[])
      exclusiveStartKey = result.LastEvaluatedKey
    } while (exclusiveStartKey)
    return loans
  }

  private async forEachRecord(kind: 'EXPENSE' | 'INVESTMENT', from: string | undefined, to: string | undefined, visit: (item: TableItem) => void) {
    const partition = `BUSINESS#${runtime.businessId()}#${kind}S`
    let exclusiveStartKey: Record<string, unknown> | undefined
    do {
      const range = from && to
        ? { KeyConditionExpression: 'GSI2PK = :partition AND GSI2SK BETWEEN :from AND :to', ExpressionAttributeValues: { ':partition': partition, ':from': `${from}#`, ':to': `${to}#\uffff` } }
        : { KeyConditionExpression: 'GSI2PK = :partition', ExpressionAttributeValues: { ':partition': partition } }
      const result = await this.repository.query({ IndexName: 'GSI2', ...range, Limit: 100, ExclusiveStartKey: exclusiveStartKey })
      for (const item of (result.Items ?? []) as TableItem[]) visit(item)
      exclusiveStartKey = result.LastEvaluatedKey
    } while (exclusiveStartKey)
  }
}

function reportDates(from: string | undefined, to: string | undefined) {
  if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) throw badRequest('Provide valid from and to dates in YYYY-MM-DD format.')
  if (from > to) throw badRequest('The start date must be on or before the end date.')
  const count = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000 + 1
  if (count > 366) throw badRequest('Report date ranges cannot exceed 366 days. Choose a shorter period.')
  return Array.from({ length: count }, (_, index) => new Date(Date.parse(`${from}T00:00:00.000Z`) + index * 86_400_000).toISOString().slice(0, 10))
}
function emptyPayments(): PaymentTotals { return { collectionsPaise: 0, interestEarnedPaise: 0, principalRepaidPaise: 0, paymentCount: 0 } }
function emptyDaily(date: string): DailyTotals { return { date, ...emptyPayments(), expensesPaise: 0, investmentsPaise: 0, disbursedPaise: 0 } }
function addPayments(target: PaymentTotals, source: PaymentTotals): PaymentTotals { return { collectionsPaise: target.collectionsPaise + source.collectionsPaise, interestEarnedPaise: target.interestEarnedPaise + source.interestEarnedPaise, principalRepaidPaise: target.principalRepaidPaise + source.principalRepaidPaise, paymentCount: target.paymentCount + source.paymentCount } }
function numberOrZero(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0 }
