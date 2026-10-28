import type { Customer, Loan, Payment } from '../types/finance'
import { formatPhone } from './format'

const apiBaseUrl = import.meta.env.DEV
  ? '/api'
  : (import.meta.env.VITE_API_URL ?? 'https://iodyn33qxf.execute-api.ap-south-2.amazonaws.com')

export interface ApiPrincipal {
  userId: string
  role: 'ADMIN' | 'STAFF' | 'CUSTOMER'
  name: string
  phone: string
  customerId?: string
  passwordChangeRequired: boolean
}

export interface LoginResponse {
  accessToken: string
  expiresIn: number
  principal: ApiPrincipal
}

export interface CustomFieldDefinition {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'date'
  required: boolean
}

export interface Page<T> {
  items: T[]
  nextCursor?: string
}

export interface BusinessSettings {
  name: string
  timeZone: string
  dailyDurationDays: number
  weeklyInstallments: number
  version: number
}

export interface StaffRecord {
  staffId: string
  userId: string
  name: string
  phone: string
  status: 'ACTIVE' | 'DISABLED'
  createdAt: string
  customFields?: Record<string, string | number | boolean>
}

export interface AuditRecord {
  actorUserId: string
  action: string
  entityId: string
  requestId: string
  occurredAt: string
  metadata: Record<string, string | number | boolean>
}

export interface ExpenseRecord {
  recordId: string
  date: string
  amountPaise: number
  reason: string
  comments?: string
  agentId?: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface InvestmentRecord {
  recordId: string
  date: string
  amountPaise: number
  investorName: string
  comments?: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface FinanceReportSummary {
  from: string
  to: string
  collectionsPaise: number
  interestEarnedPaise: number
  principalRepaidPaise: number
  paymentCount: number
  expensesPaise: number
  expenseCount: number
  investmentsPaise: number
  investmentCount: number
  disbursedPaise: number
  loansDisbursed: number
  netEarningsPaise: number
  netCashMovementPaise: number
  netCashAfterExpensesPaise: number
  daily: Array<{
    date: string
    collectionsPaise: number
    interestEarnedPaise: number
    principalRepaidPaise: number
    paymentCount: number
    expensesPaise: number
    investmentsPaise: number
    disbursedPaise: number
    netCashMovementPaise: number
  }>
  portfolio: {
    loanCount: number
    activeLoanCount: number
    totalDisbursedPaise: number
    totalCollectionsPaise: number
    totalInterestCollectedPaise: number
    totalPrincipalRepaidPaise: number
    outstandingPrincipalPaise: number
    upfrontInterestPaise: number
    bookFeesPaise: number
    totalInvestorCapitalPaise: number
    totalExpensesPaise: number
    totalInvestmentCount: number
    totalExpenseCount: number
    totalEarningsPaise: number
    calculatedCashBalancePaise: number
  }
  investorCapitalIsNotRevenue: true
}

export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const apiResponseCache = new Map<string, { expiresAt: number; value: unknown }>()
const pendingGetRequests = new Map<string, Promise<unknown>>()
const responseCacheDurationMs = 15_000
let apiCacheGeneration = 0
let apiCacheToken: string | undefined

export function clearApiCache() {
  apiCacheGeneration += 1
  apiResponseCache.clear()
  pendingGetRequests.clear()
  apiCacheToken = undefined
}

async function request<T>(
  path: string,
  token?: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  if (apiCacheToken !== token) {
    clearApiCache()
    apiCacheToken = token
  }
  if ((options.method ?? 'GET') !== 'GET') {
    const value = await sendRequest<T>(path, token, options)
    clearApiCache()
    return value
  }

  const cached = apiResponseCache.get(path)
  if (cached && cached.expiresAt > Date.now()) return cached.value as T
  if (cached) apiResponseCache.delete(path)
  const pending = pendingGetRequests.get(path)
  if (pending) return pending as Promise<T>

  const generation = apiCacheGeneration
  const pendingRequest = sendRequest<T>(path, token, options).then((value) => {
    if (generation === apiCacheGeneration) {
      apiResponseCache.set(path, { expiresAt: Date.now() + responseCacheDurationMs, value })
    }
    return value
  }).finally(() => {
    if (pendingGetRequests.get(path) === pendingRequest) pendingGetRequests.delete(path)
  })
  pendingGetRequests.set(path, pendingRequest)
  return pendingRequest
}

async function sendRequest<T>(
  path: string,
  token?: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'omit',
    cache: 'no-store',
  })
  if (response.status === 204) return undefined as T
  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const error = getApiError(payload)
    throw new ApiError(error.message ?? `Request failed (${response.status}).`, response.status, error.code)
  }
  return payload as T
}

function getApiError(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const body = payload as Record<string, unknown>
  const nested = body.error && typeof body.error === 'object' && !Array.isArray(body.error)
    ? body.error as Record<string, unknown>
    : undefined
  const message = nested?.message ?? body.message ?? (typeof body.error === 'string' ? body.error : undefined)
  const code = nested?.code ?? body.code
  return {
    ...(typeof message === 'string' && message.trim() ? { message: message.trim() } : {}),
    ...(typeof code === 'string' && code.trim() ? { code: code.trim() } : {}),
  }
}

export const api = {
  login(phone: string, password: string) {
    return request<LoginResponse>('/auth/login', undefined, { method: 'POST', body: { phone, password } })
  },
  me(token: string) {
    return request<ApiPrincipal>('/auth/me', token)
  },
  changePassword(token: string, currentPassword: string, newPassword: string) {
    return request<void>('/auth/password', token, {
      method: 'POST',
      body: { currentPassword, newPassword },
    })
  },
  customers(token: string, cursor?: string) {
    return request<Page<ApiCustomer>>(`/customers?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, token)
  },
  customer(token: string, customerId: string) {
    return request<ApiCustomer>(`/customers/${encodeURIComponent(customerId)}`, token)
  },
  loans(token: string, cursor?: string) {
    return request<Page<ApiLoan>>(`/loans?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, token)
  },
  collections(token: string, date: string, cursor?: string) {
    const params = new URLSearchParams({ date, limit: '100' })
    if (cursor) params.set('cursor', cursor)
    return request<Page<ApiPayment>>(`/collections?${params}`, token)
  },
  loanPayments(token: string, loanId: string, cursor?: string, limit = 10) {
    return request<Page<ApiPayment>>(`/loans/${encodeURIComponent(loanId)}/payments?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, token)
  },
  customerTemplate(token: string) {
    return request<{ fields: CustomFieldDefinition[] }>('/settings/custom-fields?entityType=CUSTOMER', token)
  },
  loanTemplate(token: string) {
    return request<{ fields: CustomFieldDefinition[] }>('/settings/custom-fields?entityType=LOAN', token)
  },
  staffTemplate(token: string) {
    return request<{ fields: CustomFieldDefinition[] }>('/settings/custom-fields?entityType=STAFF', token)
  },
  settings(token: string) {
    return request<BusinessSettings>('/settings', token)
  },
  updateSettings(token: string, body: Partial<Omit<BusinessSettings, 'version'>>) {
    return request<BusinessSettings>('/settings', token, { method: 'PATCH', body })
  },
  saveTemplate(token: string, entityType: 'CUSTOMER' | 'LOAN' | 'STAFF', fields: CustomFieldDefinition[]) {
    return request<{ entityType: string; fields: CustomFieldDefinition[] }>(`/settings/custom-fields/${entityType.toLowerCase()}`, token, {
      method: 'PUT',
      body: { fields },
    })
  },
  staff(token: string) {
    return request<Page<StaffRecord>>('/staff?limit=100', token)
  },
  createStaff(token: string, body: { name: string; phone: string; customFields?: Record<string, string | number | boolean> }) {
    return request<{ staff: StaffRecord; temporaryPassword: string }>('/staff', token, {
      method: 'POST',
      body,
    })
  },
  updateStaff(token: string, staffId: string, body: { name?: string; phone?: string; customFields?: Record<string, string | number | boolean | null> }) {
    return request<StaffRecord>(`/staff/${encodeURIComponent(staffId)}`, token, {
      method: 'PATCH',
      body,
    })
  },
  resetPassword(token: string, userId: string) {
    return request<{ temporaryPassword: string }>(`/users/${encodeURIComponent(userId)}/password`, token, {
      method: 'POST',
      body: {},
    })
  },
  audit(token: string) {
    return request<Page<AuditRecord>>('/audit?limit=100', token)
  },
  expenses(token: string, from: string, to: string, cursor?: string) {
    const params = new URLSearchParams({ from, to, limit: '100' })
    if (cursor) params.set('cursor', cursor)
    return request<Page<ExpenseRecord>>(`/expenses?${params}`, token)
  },
  createExpense(token: string, body: Omit<ExpenseRecord, 'recordId' | 'createdBy' | 'createdAt' | 'updatedAt'>) {
    return request<ExpenseRecord>('/expenses', token, { method: 'POST', body })
  },
  updateExpense(token: string, recordId: string, body: Partial<Omit<ExpenseRecord, 'recordId' | 'createdBy' | 'createdAt' | 'updatedAt'>>) {
    return request<ExpenseRecord>(`/expenses/${encodeURIComponent(recordId)}`, token, { method: 'PATCH', body })
  },
  investments(token: string, from: string, to: string, cursor?: string) {
    const params = new URLSearchParams({ from, to, limit: '100' })
    if (cursor) params.set('cursor', cursor)
    return request<Page<InvestmentRecord>>(`/investments?${params}`, token)
  },
  createInvestment(token: string, body: Omit<InvestmentRecord, 'recordId' | 'createdBy' | 'createdAt' | 'updatedAt'>) {
    return request<InvestmentRecord>('/investments', token, { method: 'POST', body })
  },
  updateInvestment(token: string, recordId: string, body: Partial<Omit<InvestmentRecord, 'recordId' | 'createdBy' | 'createdAt' | 'updatedAt'>>) {
    return request<InvestmentRecord>(`/investments/${encodeURIComponent(recordId)}`, token, { method: 'PATCH', body })
  },
  reportSummary(token: string, from: string, to: string) {
    const params = new URLSearchParams({ from, to })
    return request<FinanceReportSummary>(`/reports/summary?${params}`, token)
  },
  reversePayment(token: string, loanId: string, paymentId: string) {
    return request<ApiPayment>(`/loans/${encodeURIComponent(loanId)}/payments/${encodeURIComponent(paymentId)}/reverse`, token, {
      method: 'POST',
    })
  },
  createCustomer(token: string, body: Record<string, unknown>) {
    return request<{ customer: ApiCustomer; temporaryPassword: string }>('/customers', token, {
      method: 'POST',
      body,
    })
  },
  updateCustomer(token: string, customerId: string, body: Record<string, unknown>) {
    return request<ApiCustomer>(`/customers/${encodeURIComponent(customerId)}`, token, {
      method: 'PATCH',
      body,
    })
  },
  updateLoan(token: string, loanId: string, body: Record<string, unknown>) {
    return request<ApiLoan>(`/loans/${encodeURIComponent(loanId)}`, token, { method: 'PATCH', body })
  },
  updatePayment(token: string, loanId: string, paymentId: string, body: Record<string, unknown>) {
    return request<{ payment: ApiPayment; loan: ApiLoan }>(
      `/loans/${encodeURIComponent(loanId)}/payments/${encodeURIComponent(paymentId)}`,
      token,
      { method: 'PATCH', body },
    )
  },
  createLoan(token: string, body: Record<string, unknown>, idempotencyKey: string) {
    return request<ApiLoan>('/loans', token, { method: 'POST', body, idempotencyKey })
  },
  recordPayment(token: string, loanId: string, body: Record<string, unknown>, idempotencyKey: string) {
    return request<ApiPayment>(`/loans/${encodeURIComponent(loanId)}/payments`, token, {
      method: 'POST',
      body,
      idempotencyKey,
    })
  },
}

interface ApiCustomer {
  customerId: string
  userId: string
  name: string
  phone: string
  area: string
  address?: string
  email?: string
  notes?: string
  createdAt: string
  customFields?: Record<string, string | number | boolean>
}

interface ApiLoan {
  loanId: string
  customerId: string
  type: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  principalPaise: number
  upfrontInterestPaise: number
  bookFeePaise: number
  monthlyInterestPaise: number
  targetPaise: number
  collectedPaise: number
  interestCollectedPaise: number
  principalCollectedPaise: number
  status: 'ACTIVE' | 'PAID'
  disbursedOn: string
  schedule?: {
    kind: 'FIXED'
    count: number
    installments: { dueDate: string; expectedAmountPaise: number }[]
  } | {
    kind: 'MONTHLY'
    firstDueDate: string
  }
  customFields?: Record<string, string | number | boolean>
}

interface ApiPayment {
  paymentId: string
  loanId: string
  customerId: string
  amountPaise: number
  interestComponentPaise: number
  principalComponentPaise: number
  receivedOn: string
  method: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE'
  entryType?: 'PAYMENT' | 'REVERSAL'
  reversedPaymentId?: string
}

export function mapCustomer(customer: ApiCustomer): Customer {
  return {
    id: customer.customerId,
    userId: customer.userId,
    name: customer.name,
    phone: formatPhone(customer.phone),
    area: customer.area,
    joinedOn: customer.createdAt.slice(0, 10),
    address: customer.address,
    email: customer.email,
    notes: customer.notes,
    customFields: customer.customFields ?? {},
  }
}

export function mapLoan(loan: ApiLoan): Loan {
  return {
    id: loan.loanId,
    customerId: loan.customerId,
    type: loan.type[0] + loan.type.slice(1).toLowerCase() as Loan['type'],
    principalPaise: loan.principalPaise,
    interestPaise: loan.type === 'MONTHLY' ? loan.monthlyInterestPaise : loan.upfrontInterestPaise,
    feePaise: loan.bookFeePaise,
    targetPaise: loan.targetPaise,
    collectedPaise: loan.collectedPaise,
    interestCollectedPaise: loan.interestCollectedPaise,
    principalCollectedPaise: loan.principalCollectedPaise,
    disbursedOn: loan.disbursedOn,
    status: loan.status === 'PAID' ? 'Paid' : 'Active',
    customFields: loan.customFields ?? {},
    schedule: loan.schedule,
  }
}

export function mapPayment(payment: ApiPayment): Payment {
  return {
    id: payment.paymentId,
    loanId: payment.loanId,
    amountPaise: payment.amountPaise,
    interestComponentPaise: payment.interestComponentPaise,
    principalComponentPaise: payment.principalComponentPaise,
    receivedOn: payment.receivedOn,
    method: payment.method === 'BANK_TRANSFER' ? 'Bank transfer' : payment.method === 'CHEQUE'
      ? 'Cheque'
      : payment.method === 'UPI' ? 'UPI' : 'Cash',
    entryType: payment.entryType ?? 'PAYMENT',
    reversedPaymentId: payment.reversedPaymentId,
  }
}
