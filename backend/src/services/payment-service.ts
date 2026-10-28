import { createHash } from 'node:crypto'
import { z } from 'zod'
import { runtime } from '../config/runtime.js'
import { businessDate, isIsoDate } from '../domain/dates.js'
import { outstandingPaise, allocatePayment } from '../domain/loan-math.js'
import { cursorForQuery, nextCursor, parsePageSize } from '../domain/pagination.js'
import { badRequest, conflict, forbidden, notFound } from '../errors/app-error.js'
import type { Principal } from './auth-service.js'
import { BusinessService } from './business-service.js'
import { createAuditRecord } from './audit-service.js'
import { isConditionalFailure, TableRepository, type TableItem } from '../repositories/table-repository.js'
import type { LoanRecord } from './loan-service.js'

const paymentSchema = z.object({
  amountPaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  method: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE']),
  receivedOn: z.string().optional(),
}).strict()

const paymentUpdateSchema = z.object({
  amountPaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  method: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE']),
}).strict()

interface LedgerEntry extends TableItem {
  entryType: 'PAYMENT' | 'REVERSAL'
  paymentId: string
  loanId: string
  amountPaise: number
  interestComponentPaise: number
  principalComponentPaise: number
  targetComponentPaise: number
  receivedAt: string
  receivedOn: string
  method: string
  balanceAfterPaise: number
  reversedPaymentId?: string
}

const maxVersionRetries = 4

export class PaymentService {
  constructor(
    private readonly repository: TableRepository,
    private readonly business: BusinessService,
  ) {}

  async record(
    loanId: string,
    input: unknown,
    idempotencyKey: string | undefined,
    actor: Principal,
    requestId: string,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw badRequest('An Idempotency-Key header between 8 and 128 characters is required.')
    }
    const parsed = paymentSchema.safeParse(input)
    if (!parsed.success) throw badRequest('Payment details are invalid.')
    const settings = await this.business.getSettings()
    const receivedOn = parsed.data.receivedOn ?? businessDate(settings.timeZone)
    if (!isIsoDate(receivedOn)) throw badRequest('receivedOn must be a valid YYYY-MM-DD date.')
    if (receivedOn > businessDate(settings.timeZone)) throw badRequest('A payment cannot be recorded for a future date.')

    const requestHash = createHash('sha256').update(JSON.stringify({
      loanId,
      amountPaise: parsed.data.amountPaise,
      method: parsed.data.method,
      receivedOn,
    })).digest('hex')
    const idempotencyKeyHash = createHash('sha256')
      .update(`${actor.userId}|${idempotencyKey}`)
      .digest('hex')
    const idempotencyItemKey = { PK: `IDEMPOTENCY#${idempotencyKeyHash}`, SK: 'PAYMENT' }
    const existing = await this.repository.get<TableItem>(idempotencyItemKey)
    if (existing) return this.resolveIdempotentResult(existing, requestHash)

    for (let attempt = 0; attempt < maxVersionRetries; attempt += 1) {
      const loan = await this.repository.get<LoanRecord>({ PK: `LOAN#${loanId}`, SK: 'PROFILE' })
      if (!loan) throw notFound('Loan was not found.')
      if (actor.role === 'CUSTOMER' && actor.customerId !== loan.customerId) throw forbidden()
      if (receivedOn < loan.disbursedOn) throw badRequest('Payment date cannot be before loan disbursement.')
      const latestEntry = await this.repository.query({
        KeyConditionExpression: 'PK = :partition AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':partition': `LOAN#${loanId}`, ':prefix': 'PAYMENT#' },
        Limit: 1,
        ScanIndexForward: false,
      })
      const lastReceivedOn = (latestEntry.Items?.[0] as LedgerEntry | undefined)?.receivedOn
      if (lastReceivedOn && receivedOn < lastReceivedOn) {
        throw badRequest('Payment date cannot be earlier than the most recently recorded ledger entry.')
      }
      const allocation = allocatePayment(loan, parsed.data.amountPaise, receivedOn)
      const receivedAt = new Date().toISOString()
      const paymentId = await this.repository.nextBusinessId(runtime.businessId(), 'TRANSACTION')
      const projectedLoan: LoanRecord = {
        ...loan,
        collectedPaise: loan.collectedPaise + parsed.data.amountPaise,
        interestCollectedPaise: loan.interestCollectedPaise + allocation.interestPaise,
        principalCollectedPaise: loan.principalCollectedPaise + allocation.principalPaise,
        ...(loan.type === 'MONTHLY'
          && loan.principalCollectedPaise + allocation.principalPaise >= loan.principalPaise
          && !loan.principalPaidOffOn
          ? { principalPaidOffOn: receivedOn }
          : {}),
      }
      const balanceAfterPaise = outstandingPaise(projectedLoan, receivedOn)
      const balanceAsOfToday = outstandingPaise(projectedLoan, businessDate(settings.timeZone))
      const payment: LedgerEntry = {
        PK: `LOAN#${loanId}`,
        SK: `PAYMENT#${receivedAt}#${paymentId}`,
        GSI1PK: `BUSINESS#${runtime.businessId()}#DATE#${receivedOn}`,
        GSI1SK: `LEDGER#${receivedAt}#${paymentId}`,
        entryType: 'PAYMENT',
        businessId: runtime.businessId(),
        paymentId,
        loanId,
        customerId: loan.customerId,
        amountPaise: parsed.data.amountPaise,
        interestComponentPaise: allocation.interestPaise,
        principalComponentPaise: allocation.principalPaise,
        targetComponentPaise: allocation.targetPaise,
        receivedAt,
        receivedOn,
        method: parsed.data.method,
        receivedBy: actor.userId,
        balanceAfterPaise,
      }
      const paymentLocator: TableItem = {
        PK: `PAYMENT#${paymentId}`,
        SK: 'PROFILE',
        entityType: 'PAYMENT_LOCATOR',
        businessId: runtime.businessId(),
        loanId,
        paymentSortKey: payment.SK,
        entryType: 'PAYMENT',
      }
      const response = toPublicPayment(payment)
      const idempotencyItem: TableItem = {
        ...idempotencyItemKey,
        entityType: 'IDEMPOTENCY',
        businessId: runtime.businessId(),
        requestHash,
        response,
        createdAt: receivedAt,
      }
      const audit = createAuditRecord({
        actorUserId: actor.userId,
        action: 'payment_recorded',
        entityType: 'LOAN',
        entityId: loanId,
        requestId,
        occurredAt: receivedAt,
        metadata: { paymentId, amountPaise: parsed.data.amountPaise },
      })
      try {
        await this.repository.transact({
          TransactItems: [
            {
              Update: {
                TableName: process.env.TABLE_NAME,
                Key: { PK: `LOAN#${loanId}`, SK: 'PROFILE' },
                UpdateExpression: `SET collectedPaise = collectedPaise + :amount, interestCollectedPaise = interestCollectedPaise + :interest, principalCollectedPaise = principalCollectedPaise + :principal, #status = :status, updatedAt = :updatedAt, #version = #version + :one${projectedLoan.principalPaidOffOn && !loan.principalPaidOffOn ? ', principalPaidOffOn = :principalPaidOffOn' : ''}`,
                ConditionExpression: '#version = :version AND #status = :active AND collectedPaise <= :maxCollected',
                ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
                ExpressionAttributeValues: {
                  ':amount': parsed.data.amountPaise,
                  ':interest': allocation.interestPaise,
                  ':principal': allocation.principalPaise,
                  ':status': balanceAsOfToday === 0 ? 'PAID' : 'ACTIVE',
                  ':updatedAt': receivedAt,
                  ':one': 1,
                  ':version': loan.version,
                  ':active': 'ACTIVE',
                  ':maxCollected': loan.collectedPaise,
                  ...(projectedLoan.principalPaidOffOn && !loan.principalPaidOffOn
                    ? { ':principalPaidOffOn': projectedLoan.principalPaidOffOn }
                    : {}),
                },
              },
            },
            { Put: { TableName: process.env.TABLE_NAME, Item: payment, ConditionExpression: 'attribute_not_exists(PK)' } },
            { Put: { TableName: process.env.TABLE_NAME, Item: paymentLocator, ConditionExpression: 'attribute_not_exists(PK)' } },
            { Put: { TableName: process.env.TABLE_NAME, Item: idempotencyItem, ConditionExpression: 'attribute_not_exists(PK)' } },
            { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
          ],
        })
        return response
      } catch (error) {
        const retryResult = await this.repository.get<TableItem>(idempotencyItemKey)
        if (retryResult) return this.resolveIdempotentResult(retryResult, requestHash)
        if (isConditionalFailure(error) && attempt < maxVersionRetries - 1) continue
        if (isConditionalFailure(error)) {
          throw conflict('The loan changed while recording this payment. Please retry.', 'CONCURRENT_PAYMENT')
        }
        throw error
      }
    }
    throw conflict('The loan changed while recording this payment. Please retry.', 'CONCURRENT_PAYMENT')
  }

  async listForLoan(
    loanId: string,
    query: Record<string, string | undefined>,
    actor: Principal,
  ) {
    const loan = await this.repository.get<LoanRecord>({ PK: `LOAN#${loanId}`, SK: 'PROFILE' })
    if (!loan) throw notFound('Loan was not found.')
    if (actor.role === 'CUSTOMER' && actor.customerId !== loan.customerId) throw forbidden()
    const partition = `LOAN#${loanId}`
    const limit = parsePageSize(query.limit)
    const secret = await runtime.jwtSecret()
    const exclusiveStartKey = cursorForQuery(query.cursor, secret, 'PK', partition)
    const result = await this.repository.query({
      KeyConditionExpression: 'PK = :partition AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':partition': partition, ':prefix': 'PAYMENT#' },
      Limit: limit,
      ScanIndexForward: false,
      ExclusiveStartKey: exclusiveStartKey,
    })
    return {
      items: ((result.Items ?? []) as LedgerEntry[]).map(toPublicPayment),
      nextCursor: nextCursor(result.LastEvaluatedKey, secret),
    }
  }

  async listForDate(date: string, query: Record<string, string | undefined>) {
    if (!isIsoDate(date)) throw badRequest('date must be a valid YYYY-MM-DD date.')
    const partition = `BUSINESS#${runtime.businessId()}#DATE#${date}`
    const limit = parsePageSize(query.limit)
    const secret = await runtime.jwtSecret()
    const exclusiveStartKey = cursorForQuery(query.cursor, secret, 'GSI1PK', partition)
    const result = await this.repository.query({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :partition AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: { ':partition': partition, ':prefix': 'LEDGER#' },
      Limit: limit,
      ScanIndexForward: false,
      ExclusiveStartKey: exclusiveStartKey,
    })
    return {
      items: ((result.Items ?? []) as LedgerEntry[]).map(toPublicPayment),
      nextCursor: nextCursor(result.LastEvaluatedKey, secret),
    }
  }

  async reverse(
    loanId: string,
    paymentId: string,
    actor: Principal,
    requestId: string,
  ) {
    const loan = await this.repository.get<LoanRecord>({ PK: `LOAN#${loanId}`, SK: 'PROFILE' })
    if (!loan) throw notFound('Loan was not found.')
    const locator = await this.repository.get<TableItem>({ PK: `PAYMENT#${paymentId}`, SK: 'PROFILE' })
    if (!locator || locator.loanId !== loanId || locator.entryType !== 'PAYMENT'
      || typeof locator.paymentSortKey !== 'string') {
      throw notFound('Payment was not found for this loan.')
    }
    const original = await this.repository.get<LedgerEntry>({
      PK: `LOAN#${loanId}`,
      SK: locator.paymentSortKey,
    })
    if (!original || original.entryType !== 'PAYMENT') throw notFound('Payment was not found for this loan.')
    const reversalMarker = await this.repository.get<TableItem>({
      PK: `PAYMENT#${paymentId}`,
      SK: 'REVERSAL',
    })
    if (reversalMarker) throw conflict('This payment has already been reversed.', 'PAYMENT_ALREADY_REVERSED')

    const reversedAt = new Date().toISOString()
    const settings = await this.business.getSettings()
    const reversedOn = businessDate(settings.timeZone)
    const reversalId = await this.repository.nextBusinessId(runtime.businessId(), 'TRANSACTION')
    const projectedPrincipal = loan.principalCollectedPaise - original.principalComponentPaise
    const { principalPaidOffOn: previousPayoffDate, ...loanWithoutPayoffDate } = loan
    const projectedLoan: LoanRecord = {
      ...(projectedPrincipal >= loan.principalPaise ? loan : loanWithoutPayoffDate),
      collectedPaise: loan.collectedPaise - original.amountPaise,
      interestCollectedPaise: loan.interestCollectedPaise - original.interestComponentPaise,
      principalCollectedPaise: projectedPrincipal,
      status: 'ACTIVE',
    }
    if (projectedLoan.collectedPaise < 0 || projectedLoan.interestCollectedPaise < 0 || projectedLoan.principalCollectedPaise < 0) {
      throw conflict('This payment cannot be reversed because the ledger no longer matches the loan balance.')
    }
    const balanceAfterPaise = outstandingPaise(projectedLoan, reversedOn)
    const reversal: LedgerEntry = {
      PK: `LOAN#${loanId}`,
      SK: `PAYMENT#${reversedAt}#${reversalId}`,
      GSI1PK: `BUSINESS#${runtime.businessId()}#DATE#${reversedOn}`,
      GSI1SK: `LEDGER#${reversedAt}#${reversalId}`,
      entryType: 'REVERSAL',
      businessId: runtime.businessId(),
      paymentId: reversalId,
      reversedPaymentId: paymentId,
      loanId,
      customerId: loan.customerId,
      amountPaise: original.amountPaise,
      interestComponentPaise: original.interestComponentPaise,
      principalComponentPaise: original.principalComponentPaise,
      targetComponentPaise: original.targetComponentPaise,
      receivedAt: reversedAt,
      receivedOn: reversedOn,
      method: original.method,
      receivedBy: actor.userId,
      balanceAfterPaise,
    }
    const marker: TableItem = {
      PK: `PAYMENT#${paymentId}`,
      SK: 'REVERSAL',
      entityType: 'PAYMENT_REVERSAL_MARKER',
      businessId: runtime.businessId(),
      loanId,
      reversalId,
      reversedBy: actor.userId,
      reversedAt,
    }
    const audit = createAuditRecord({
      actorUserId: actor.userId,
      action: 'payment_reversed',
      entityType: 'LOAN',
      entityId: loanId,
      requestId,
      occurredAt: reversedAt,
      metadata: { paymentId, reversalId, amountPaise: original.amountPaise },
    })
    try {
      await this.repository.transact({
        TransactItems: [
          {
            Update: {
              TableName: process.env.TABLE_NAME,
              Key: { PK: `LOAN#${loanId}`, SK: 'PROFILE' },
              UpdateExpression: `SET collectedPaise = collectedPaise - :amount, interestCollectedPaise = interestCollectedPaise - :interest, principalCollectedPaise = principalCollectedPaise - :principal, #status = :active, updatedAt = :updatedAt, #version = #version + :one${projectedPrincipal < loan.principalPaise && previousPayoffDate ? ' REMOVE principalPaidOffOn' : ''}`,
              ConditionExpression: '#version = :version AND collectedPaise >= :amount AND interestCollectedPaise >= :interest AND principalCollectedPaise >= :principal',
              ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
              ExpressionAttributeValues: {
                ':amount': original.amountPaise,
                ':interest': original.interestComponentPaise,
                ':principal': original.principalComponentPaise,
                ':active': 'ACTIVE',
                ':updatedAt': reversedAt,
                ':one': 1,
                ':version': loan.version,
              },
            },
          },
          { Put: { TableName: process.env.TABLE_NAME, Item: reversal } },
          { Put: { TableName: process.env.TABLE_NAME, Item: marker, ConditionExpression: 'attribute_not_exists(PK)' } },
          { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
        ],
      })
    } catch (error) {
      if (isConditionalFailure(error)) throw conflict('This payment was already reversed or the loan changed. Reload and try again.')
      throw error
    }
    return toPublicPayment(reversal)
  }

  async update(
    loanId: string,
    paymentId: string,
    input: unknown,
    actor: Principal,
    requestId: string,
  ) {
    if (actor.role !== 'ADMIN') throw forbidden()
    const parsed = paymentUpdateSchema.safeParse(input)
    if (!parsed.success) throw badRequest('Transaction amount and method are required.')
    const [loan, locator] = await Promise.all([
      this.repository.get<LoanRecord>({ PK: `LOAN#${loanId}`, SK: 'PROFILE' }),
      this.repository.get<TableItem>({ PK: `PAYMENT#${paymentId}`, SK: 'PROFILE' }),
    ])
    if (!loan) throw notFound('Loan was not found.')
    if (!locator || locator.loanId !== loanId || locator.entryType !== 'PAYMENT'
      || typeof locator.paymentSortKey !== 'string') {
      throw notFound('Transaction was not found for this loan.')
    }
    const original = await this.repository.get<LedgerEntry>({ PK: `LOAN#${loanId}`, SK: locator.paymentSortKey })
    if (!original || original.entryType !== 'PAYMENT') throw notFound('Transaction was not found for this loan.')
    if (await this.repository.get<TableItem>({ PK: `PAYMENT#${paymentId}`, SK: 'REVERSAL' })) {
      throw conflict('A reversed transaction cannot be edited.')
    }
    const entries = await this.repository.query({
      KeyConditionExpression: 'PK = :partition AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':partition': `LOAN#${loanId}`, ':prefix': 'PAYMENT#' },
      ScanIndexForward: false,
      Limit: 1,
    })
    if ((entries.Items?.[0] as LedgerEntry | undefined)?.paymentId !== paymentId) {
      throw conflict('Only the latest transaction can be edited so later payment allocations remain valid.')
    }
    const baseLoan: LoanRecord = {
      ...loan,
      status: 'ACTIVE',
      collectedPaise: loan.collectedPaise - original.amountPaise,
      interestCollectedPaise: loan.interestCollectedPaise - original.interestComponentPaise,
      principalCollectedPaise: loan.principalCollectedPaise - original.principalComponentPaise,
    }
    const settings = await this.business.getSettings()
    const allocation = allocatePayment(baseLoan, parsed.data.amountPaise, original.receivedOn)
    const projectedLoan: LoanRecord = {
      ...baseLoan,
      collectedPaise: baseLoan.collectedPaise + parsed.data.amountPaise,
      interestCollectedPaise: baseLoan.interestCollectedPaise + allocation.interestPaise,
      principalCollectedPaise: baseLoan.principalCollectedPaise + allocation.principalPaise,
    }
    const balanceAfterPaise = outstandingPaise(projectedLoan, original.receivedOn)
    const todayBalance = outstandingPaise(projectedLoan, businessDate(settings.timeZone))
    const updatedAt = new Date().toISOString()
    const { principalPaidOffOn: _oldPaidOffOn, ...projectedWithoutPaidOffOn } = projectedLoan
    const updatedLoan: LoanRecord = {
      ...projectedWithoutPaidOffOn,
      ...(loan.type === 'MONTHLY' && projectedLoan.principalCollectedPaise >= loan.principalPaise
        ? { principalPaidOffOn: original.receivedOn }
        : {}),
      status: todayBalance === 0 ? 'PAID' : 'ACTIVE',
      updatedAt,
      version: loan.version + 1,
    }
    const updatedPayment: LedgerEntry = {
      ...original,
      amountPaise: parsed.data.amountPaise,
      method: parsed.data.method,
      interestComponentPaise: allocation.interestPaise,
      principalComponentPaise: allocation.principalPaise,
      balanceAfterPaise,
    }
    const audit = createAuditRecord({
      actorUserId: actor.userId,
      action: 'transaction_updated',
      entityType: 'LOAN',
      entityId: loanId,
      requestId,
      occurredAt: updatedAt,
      metadata: {
        transactionId: paymentId,
        before: JSON.stringify({ amountPaise: original.amountPaise, method: original.method }),
        after: JSON.stringify({ amountPaise: updatedPayment.amountPaise, method: updatedPayment.method }),
      },
    })
    try {
      await this.repository.transact({
        TransactItems: [
          { Put: { TableName: process.env.TABLE_NAME, Item: updatedLoan, ConditionExpression: '#version = :version', ExpressionAttributeNames: { '#version': 'version' }, ExpressionAttributeValues: { ':version': loan.version } } },
          { Put: { TableName: process.env.TABLE_NAME, Item: updatedPayment, ConditionExpression: 'amountPaise = :amount AND entryType = :entryType', ExpressionAttributeValues: { ':amount': original.amountPaise, ':entryType': 'PAYMENT' } } },
          { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
        ],
      })
    } catch (error) {
      if (isConditionalFailure(error)) throw conflict('Transaction or loan changed in another request. Reload and try again.')
      throw error
    }
    return { payment: toPublicPayment(updatedPayment), loan: toPublicLoanForPayment(updatedLoan) }
  }

  private resolveIdempotentResult(item: TableItem, requestHash: string) {
    if (item.requestHash !== requestHash) {
      throw conflict('This Idempotency-Key was already used for a different payment.', 'IDEMPOTENCY_KEY_REUSED')
    }
    return item.response
  }
}

function toPublicLoanForPayment(loan: LoanRecord) {
  const {
    PK: _pk, SK: _sk, GSI2PK: _gsi2pk, GSI2SK: _gsi2sk,
    GSI3PK: _gsi3pk, GSI3SK: _gsi3sk, entityType: _type,
    businessId: _businessId, ...publicRecord
  } = loan
  return publicRecord
}

function toPublicPayment(payment: LedgerEntry) {
  const {
    PK: _pk,
    SK: _sk,
    GSI1PK: _gsi1pk,
    GSI1SK: _gsi1sk,
    entityType: _entityType,
    businessId: _businessId,
    ...publicRecord
  } = payment
  return publicRecord
}
