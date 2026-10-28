import { createHash } from 'node:crypto'
import { z } from 'zod'
import { runtime } from '../config/runtime.js'
import { addCalendarDays, addCalendarMonths, businessDate, requireIsoDate } from '../domain/dates.js'
import { updateCustomFields, validateCustomFields, validateTemplate, type CustomFieldDefinition } from '../domain/custom-fields.js'
import { cursorForQuery, nextCursor, parsePageSize } from '../domain/pagination.js'
import { stableJson } from '../domain/json.js'
import { badRequest, conflict, forbidden, notFound } from '../errors/app-error.js'
import type { Principal } from './auth-service.js'
import { BusinessService } from './business-service.js'
import { createAuditRecord } from './audit-service.js'
import { isConditionalFailure, TableRepository, type TableItem } from '../repositories/table-repository.js'

const loanCreateSchema = z.object({
  customerId: z.string().min(1).max(100),
  type: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  principalPaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  upfrontInterestPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  bookFeePaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  monthlyInterestPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  disbursedOn: z.string().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
}).strict()

const loanUpdateSchema = loanCreateSchema.omit({ customerId: true }).partial().strict()

export interface LoanRecord extends TableItem {
  entityType: 'LOAN'
  loanId: string
  customerId: string
  type: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  principalPaise: number
  upfrontInterestPaise: number
  bookFeePaise: number
  monthlyInterestPaise: number
  disbursedPaise: number
  targetPaise: number
  collectedPaise: number
  interestCollectedPaise: number
  principalCollectedPaise: number
  status: 'ACTIVE' | 'PAID'
  version: number
  disbursedOn: string
  principalPaidOffOn?: string
  customFields: Record<string, string | number | boolean>
  customFieldDefinitions: unknown[]
}

export class LoanService {
  constructor(
    private readonly repository: TableRepository,
    private readonly business: BusinessService,
  ) {}

  async create(input: unknown, idempotencyKey: string | undefined, actor: Principal, requestId: string) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw badRequest('An Idempotency-Key header between 8 and 128 characters is required.')
    }
    const parsed = loanCreateSchema.safeParse(input)
    if (!parsed.success) throw badRequest('Loan details are invalid.')
    const requestHash = createHash('sha256').update(stableJson(parsed.data)).digest('hex')
    const idempotencyHash = createHash('sha256').update(`${actor.userId}|${idempotencyKey}`).digest('hex')
    const idempotencyKeyPair = { PK: `IDEMPOTENCY#${idempotencyHash}`, SK: 'LOAN' }
    const existing = await this.repository.get<TableItem>(idempotencyKeyPair)
    if (existing) return resolveIdempotentResult(existing, requestHash)
    const [customer, settings, definitions] = await Promise.all([
      this.repository.get<TableItem>({ PK: `CUSTOMER#${parsed.data.customerId}`, SK: 'PROFILE' }),
      this.business.getSettings(),
      this.business.getCustomFieldDefinitions('LOAN'),
    ])
    if (!customer) throw notFound('Customer was not found.')

    if (parsed.data.type === 'MONTHLY') {
      if (parsed.data.monthlyInterestPaise <= 0) throw badRequest('Monthly loans require a positive monthly interest amount.')
      if (parsed.data.upfrontInterestPaise !== 0 || parsed.data.bookFeePaise !== 0) {
        throw badRequest('Monthly loans do not support upfront interest or a book fee.')
      }
    } else {
      if (parsed.data.monthlyInterestPaise !== 0) throw badRequest('Daily and weekly loans do not use monthly interest.')
      if (parsed.data.upfrontInterestPaise + parsed.data.bookFeePaise > parsed.data.principalPaise) {
        throw badRequest('Upfront interest and book fee cannot exceed the nominal loan amount.')
      }
    }

    const disbursedOn = requireIsoDate(
      parsed.data.disbursedOn ?? businessDate(settings.timeZone),
      'disbursedOn',
    )
    const customFields = validateCustomFields(parsed.data.customFields, definitions)
    const loanId = await this.repository.nextBusinessId(runtime.businessId(), 'LOAN')
    const createdAt = new Date().toISOString()
    const isMonthly = parsed.data.type === 'MONTHLY'
    const disbursedPaise = isMonthly
      ? parsed.data.principalPaise
      : parsed.data.principalPaise - parsed.data.upfrontInterestPaise - parsed.data.bookFeePaise

    const schedule = parsed.data.type === 'DAILY'
      ? buildInstallments(
          parsed.data.principalPaise,
          settings.dailyDurationDays,
          (index) => addCalendarDays(disbursedOn, index + 1),
        )
      : parsed.data.type === 'WEEKLY'
        ? buildInstallments(
            parsed.data.principalPaise,
            settings.weeklyInstallments,
            (index) => addCalendarDays(disbursedOn, (index + 1) * 7),
          )
        : { kind: 'MONTHLY', firstDueDate: addCalendarMonths(disbursedOn, 1) }

    const loan: LoanRecord = {
      PK: `LOAN#${loanId}`,
      SK: 'PROFILE',
      GSI2PK: `BUSINESS#${runtime.businessId()}#LOANS`,
      GSI2SK: `${createdAt}#${loanId}`,
      GSI3PK: `CUSTOMER#${parsed.data.customerId}#LOANS`,
      GSI3SK: `${createdAt}#${loanId}`,
      entityType: 'LOAN',
      businessId: runtime.businessId(),
      loanId,
      customerId: parsed.data.customerId,
      type: parsed.data.type,
      principalPaise: parsed.data.principalPaise,
      upfrontInterestPaise: parsed.data.upfrontInterestPaise,
      bookFeePaise: parsed.data.bookFeePaise,
      monthlyInterestPaise: parsed.data.monthlyInterestPaise,
      disbursedPaise,
      targetPaise: parsed.data.principalPaise,
      collectedPaise: 0,
      interestCollectedPaise: 0,
      principalCollectedPaise: 0,
      status: 'ACTIVE',
      version: 1,
      disbursedOn,
      schedule,
      customFields,
      customFieldDefinitions: definitions,
      createdAt,
      updatedAt: createdAt,
      createdBy: actor.userId,
    }
    const audit = createAuditRecord({
      actorUserId: actor.userId,
      action: 'loan_created',
      entityType: 'LOAN',
      entityId: loanId,
      requestId,
      occurredAt: createdAt,
      metadata: {
        customerId: parsed.data.customerId,
        loanType: parsed.data.type,
        principalPaise: parsed.data.principalPaise,
      },
    })
    const publicLoan = toPublicLoan(loan)
    const idempotencyItem: TableItem = {
      ...idempotencyKeyPair,
      entityType: 'IDEMPOTENCY',
      businessId: runtime.businessId(),
      requestHash,
      response: publicLoan,
      createdAt,
    }
    try {
      await this.repository.transact({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: process.env.TABLE_NAME,
              Key: { PK: `CUSTOMER#${parsed.data.customerId}`, SK: 'PROFILE' },
              ConditionExpression: 'attribute_exists(PK)',
            },
          },
          { Put: { TableName: process.env.TABLE_NAME, Item: loan, ConditionExpression: 'attribute_not_exists(PK)' } },
          { Put: { TableName: process.env.TABLE_NAME, Item: idempotencyItem, ConditionExpression: 'attribute_not_exists(PK)' } },
          { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
        ],
      })
      return publicLoan
    } catch (error) {
      const retryResult = await this.repository.get<TableItem>(idempotencyKeyPair)
      if (retryResult) return resolveIdempotentResult(retryResult, requestHash)
      if (isConditionalFailure(error)) throw conflict('The customer changed while creating this loan. Reload and try again.')
      throw error
    }
  }

  async list(query: Record<string, string | undefined>, actor: Principal) {
    const customerView = actor.role === 'CUSTOMER'
    if (customerView && !actor.customerId) throw forbidden()
    const partition = customerView
      ? `CUSTOMER#${actor.customerId}#LOANS`
      : `BUSINESS#${runtime.businessId()}#LOANS`
    const index = customerView ? 'GSI3' : 'GSI2'
    const partitionAttribute = `${index}PK`
    const limit = parsePageSize(query.limit)
    const secret = await runtime.jwtSecret()
    const exclusiveStartKey = cursorForQuery(query.cursor, secret, partitionAttribute, partition)
    const result = await this.repository.query({
      IndexName: index,
      KeyConditionExpression: `${partitionAttribute} = :partition`,
      ExpressionAttributeValues: { ':partition': partition },
      Limit: limit,
      ScanIndexForward: false,
      ExclusiveStartKey: exclusiveStartKey,
    })
    const records = (result.Items ?? []) as LoanRecord[]
    return {
      items: records.map(toPublicLoan),
      nextCursor: nextCursor(result.LastEvaluatedKey, secret),
    }
  }

  async get(loanId: string, actor: Principal) {
    const loan = await this.repository.get<LoanRecord>({ PK: `LOAN#${loanId}`, SK: 'PROFILE' })
    if (!loan) throw notFound('Loan was not found.')
    if (actor.role === 'CUSTOMER' && loan.customerId !== actor.customerId) throw forbidden()
    return toPublicLoan(loan)
  }

  async update(loanId: string, input: unknown, actor: Principal, requestId: string) {
    if (actor.role !== 'ADMIN') throw forbidden()
    const parsed = loanUpdateSchema.safeParse(input)
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      throw badRequest('Provide valid loan fields to update.')
    }
    const current = await this.repository.get<LoanRecord>({ PK: `LOAN#${loanId}`, SK: 'PROFILE' })
    if (!current) throw notFound('Loan was not found.')
    const financialKeys = ['type', 'principalPaise', 'upfrontInterestPaise', 'bookFeePaise', 'monthlyInterestPaise', 'disbursedOn']
    const changesFinancialTerms = financialKeys.some((key) => key in parsed.data)
    const entries = changesFinancialTerms
      ? await this.repository.query({
          KeyConditionExpression: 'PK = :partition AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':partition': `LOAN#${loanId}`, ':prefix': 'PAYMENT#' },
        })
      : undefined
    if (entries?.Items?.length) {
      throw conflict('Loan financial terms cannot be edited after transactions are posted. Update custom fields instead.')
    }

    const [settings, definitions] = await Promise.all([
      this.business.getSettings(),
      this.business.getCustomFieldDefinitions('LOAN'),
    ])
    const nextType = parsed.data.type ?? current.type
    const principalPaise = parsed.data.principalPaise ?? current.principalPaise
    const upfrontInterestPaise = parsed.data.upfrontInterestPaise ?? current.upfrontInterestPaise
    const bookFeePaise = parsed.data.bookFeePaise ?? current.bookFeePaise
    const monthlyInterestPaise = parsed.data.monthlyInterestPaise ?? current.monthlyInterestPaise
    const disbursedOn = requireIsoDate(parsed.data.disbursedOn ?? current.disbursedOn, 'disbursedOn')
    if (nextType === 'MONTHLY') {
      if (monthlyInterestPaise <= 0 || upfrontInterestPaise !== 0 || bookFeePaise !== 0) {
        throw badRequest('Monthly loans require positive monthly interest and do not support upfront interest or book fees.')
      }
    } else if (monthlyInterestPaise !== 0 || upfrontInterestPaise + bookFeePaise > principalPaise) {
      throw badRequest('Daily and weekly loans require monthly interest of zero, and upfront charges cannot exceed principal.')
    }
    const customFields = parsed.data.customFields === undefined
      ? current.customFields
      : updateCustomFields(current.customFields, parsed.data.customFields, definitions)
    const existingDefinitions = validateTemplate(current.customFieldDefinitions)
    const currentKeys = new Set(definitions.map((definition) => definition.key))
    const combinedDefinitions = [
      ...existingDefinitions.filter((definition) => !currentKeys.has(definition.key)),
      ...definitions,
    ] as CustomFieldDefinition[]
    const updatedAt = new Date().toISOString()
    const disbursedPaise = nextType === 'MONTHLY'
      ? principalPaise
      : principalPaise - upfrontInterestPaise - bookFeePaise
    const schedule = nextType === 'DAILY'
      ? buildInstallments(principalPaise, settings.dailyDurationDays, (index) => addCalendarDays(disbursedOn, index + 1))
      : nextType === 'WEEKLY'
        ? buildInstallments(principalPaise, settings.weeklyInstallments, (index) => addCalendarDays(disbursedOn, (index + 1) * 7))
        : { kind: 'MONTHLY', firstDueDate: addCalendarMonths(disbursedOn, 1) }
    const updated: LoanRecord = {
      ...current,
      type: nextType,
      principalPaise,
      upfrontInterestPaise,
      bookFeePaise,
      monthlyInterestPaise,
      disbursedPaise,
      targetPaise: principalPaise,
      disbursedOn,
      schedule,
      customFields,
      customFieldDefinitions: combinedDefinitions,
      updatedAt,
      version: current.version + 1,
      status: 'ACTIVE',
    }
    const audit = createAuditRecord({
      actorUserId: actor.userId,
      action: 'loan_updated',
      entityType: 'LOAN',
      entityId: loanId,
      requestId,
      occurredAt: updatedAt,
      metadata: {
        before: JSON.stringify(pickLoanAuditFields(current, parsed.data)),
        after: JSON.stringify(pickLoanAuditFields(updated, parsed.data)),
      },
    })
    try {
      await this.repository.transact({
        TransactItems: [
          { Put: { TableName: process.env.TABLE_NAME, Item: updated, ConditionExpression: '#version = :version', ExpressionAttributeNames: { '#version': 'version' }, ExpressionAttributeValues: { ':version': current.version } } },
          { Put: { TableName: process.env.TABLE_NAME, Item: audit } },
        ],
      })
    } catch (error) {
      if (isConditionalFailure(error)) throw conflict('Loan changed in another request. Reload and try again.')
      throw error
    }
    return toPublicLoan(updated)
  }
}

function pickLoanAuditFields(loan: LoanRecord, input: Record<string, unknown>) {
  const keys = new Set([...Object.keys(input), 'targetPaise', 'disbursedPaise', 'schedule', 'status'])
  return Object.fromEntries([...keys].map((key) => [key, loan[key as keyof LoanRecord]]))
}

function resolveIdempotentResult(item: TableItem, requestHash: string) {
  if (item.requestHash !== requestHash) {
    throw conflict('This Idempotency-Key was already used for a different loan.', 'IDEMPOTENCY_KEY_REUSED')
  }
  return item.response
}

function buildInstallments(
  targetPaise: number,
  count: number,
  dueDateAt: (index: number) => string,
) {
  const baseAmount = Math.floor(targetPaise / count)
  const remainder = targetPaise % count
  return {
    kind: 'FIXED',
    count,
    installments: Array.from({ length: count }, (_, index) => ({
      dueDate: dueDateAt(index),
      expectedAmountPaise: baseAmount + (index < remainder ? 1 : 0),
    })),
  }
}

function toPublicLoan(loan: LoanRecord) {
  const {
    PK: _pk,
    SK: _sk,
    GSI2PK: _gsi2pk,
    GSI2SK: _gsi2sk,
    GSI3PK: _gsi3pk,
    GSI3SK: _gsi3sk,
    entityType: _entityType,
    businessId: _businessId,
    ...publicRecord
  } = loan
  return publicRecord
}
