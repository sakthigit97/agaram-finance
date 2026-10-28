import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda'
import { AppError, badRequest, forbidden, notFound, unauthorized } from '../errors/app-error.js'
import { AuthService, type Principal } from '../services/auth-service.js'
import { BusinessService } from '../services/business-service.js'
import { CustomerService } from '../services/customer-service.js'
import { LoanService } from '../services/loan-service.js'
import { PaymentService } from '../services/payment-service.js'
import { StaffService } from '../services/staff-service.js'
import { AuditService } from '../services/audit-service.js'
import { FinanceRecordService } from '../services/finance-record-service.js'
import { ReportsService } from '../services/reports-service.js'
import { TableRepository, isMissingTable } from '../repositories/table-repository.js'
import { isIsoDate } from '../domain/dates.js'

const repository = new TableRepository()
const auth = new AuthService(repository)
const business = new BusinessService(repository)
const customers = new CustomerService(repository, auth, business)
const loans = new LoanService(repository, business)
const payments = new PaymentService(repository, business)
const staff = new StaffService(repository, auth, business)
const audit = new AuditService(repository)
const financeRecords = new FinanceRecordService(repository)
const reports = new ReportsService(repository)
const maxBodyBytes = 32 * 1024

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const requestId = event.requestContext.requestId || 'unknown'
  try {
    const method = event.requestContext.http.method.toUpperCase()
    if (method === 'OPTIONS') return response(204)
    const segments = decodePath(event.rawPath)
    if (method === 'GET' && segments.join('/') === 'health') return response(200, { status: 'ok', service: 'agaram-finance-api' })

    const parsedBody = parseBody(event)
    if (method === 'POST' && segments.join('/') === 'auth/login') {
      const body = objectBody(parsedBody)
      if (Object.keys(body).some((key) => key !== 'phone' && key !== 'password')) {
        throw badRequest('Login request contains unsupported fields.')
      }
      if (typeof body.phone !== 'string' || typeof body.password !== 'string') {
        throw badRequest('Phone number and password are required.')
      }
      const result = await auth.authenticate(
        body.phone,
        body.password,
        event.requestContext.http.sourceIp ?? 'unknown',
      )
      return response(200, result)
    }

    const principal = await authenticate(event)
    if (principal.passwordChangeRequired && !(method === 'POST' && segments.join('/') === 'auth/password')
      && !(method === 'GET' && segments.join('/') === 'auth/me')) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password before continuing.')
    }
    const request = { principal, requestId }
    const query = event.queryStringParameters ?? {}
    const route = segments.join('/')

    if (method === 'GET' && route === 'auth/me') {
      return response(200, await auth.getPublicUser(principal.userId))
    }
    if (method === 'POST' && route === 'auth/password') {
      const body = objectBody(parsedBody)
      if (typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
        throw badRequest('Current and new password are required.')
      }
      await auth.changePassword(principal, {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      }, requestId)
      return response(204)
    }
    if (method === 'POST' && segments[0] === 'users' && segments[2] === 'password' && segments.length === 3) {
      requireRole(principal, ['ADMIN'])
      const body = objectBody(parsedBody)
      if (Object.keys(body).length > 0) throw badRequest('Password reset does not accept a request body.')
      return response(200, await auth.resetPassword(segments[1], principal, requestId))
    }

    if (route === 'customers' && method === 'POST') {
      requireRole(principal, ['ADMIN', 'STAFF'])
      return response(201, await customers.create(parsedBody, request.principal, request.requestId))
    }
    if (route === 'customers' && method === 'GET') {
      requireRole(principal, ['ADMIN', 'STAFF'])
      return response(200, await customers.list(query))
    }
    if (segments[0] === 'customers' && segments.length === 2 && method === 'GET') {
      return response(200, await customers.get(segments[1], principal))
    }
    if (segments[0] === 'customers' && segments.length === 2 && method === 'PATCH') {
      requireRole(principal, ['ADMIN'])
      return response(200, await customers.update(segments[1], parsedBody, principal, requestId))
    }

    if (route === 'loans' && method === 'POST') {
      requireRole(principal, ['ADMIN', 'STAFF'])
      return response(201, await loans.create(
        parsedBody,
        event.headers['idempotency-key'] ?? event.headers['Idempotency-Key'],
        principal,
        requestId,
      ))
    }
    if (route === 'loans' && method === 'GET') {
      requireRole(principal, ['ADMIN', 'STAFF', 'CUSTOMER'])
      return response(200, await loans.list(query, principal))
    }
    if (segments[0] === 'loans' && segments.length === 2 && method === 'PATCH') {
      requireRole(principal, ['ADMIN'])
      return response(200, await loans.update(segments[1], parsedBody, principal, requestId))
    }
    if (segments[0] === 'loans' && segments.length === 2 && method === 'GET') {
      return response(200, await loans.get(segments[1], principal))
    }
    if (segments[0] === 'loans' && segments[2] === 'payments' && segments.length === 3 && method === 'POST') {
      requireRole(principal, ['ADMIN', 'STAFF'])
      return response(201, await payments.record(
        segments[1],
        parsedBody,
        event.headers['idempotency-key'] ?? event.headers['Idempotency-Key'],
        principal,
        requestId,
      ))
    }
    if (segments[0] === 'loans' && segments[2] === 'payments' && segments.length === 3 && method === 'GET') {
      requireRole(principal, ['ADMIN', 'STAFF', 'CUSTOMER'])
      return response(200, await payments.listForLoan(segments[1], query, principal))
    }
    if (segments[0] === 'loans' && segments[2] === 'payments' && segments.length === 4 && method === 'PATCH') {
      requireRole(principal, ['ADMIN'])
      return response(200, await payments.update(segments[1], segments[3], parsedBody, principal, requestId))
    }
    if (segments[0] === 'loans' && segments[2] === 'payments' && segments[4] === 'reverse'
      && segments.length === 5 && method === 'POST') {
      requireRole(principal, ['ADMIN'])
      return response(201, await payments.reverse(segments[1], segments[3], principal, requestId))
    }
    if (route === 'collections' && method === 'GET') {
      requireRole(principal, ['ADMIN', 'STAFF'])
      const date = query.date
      if (!date || !isIsoDate(date)) throw badRequest('A valid date query parameter (YYYY-MM-DD) is required.')
      return response(200, await payments.listForDate(date, query))
    }

    if (route === 'settings' && method === 'GET') {
      requireRole(principal, ['ADMIN'])
      return response(200, await business.getSettings())
    }
    if (route === 'settings' && method === 'PATCH') {
      requireRole(principal, ['ADMIN'])
      return response(200, await business.updateSettings(parsedBody, principal.userId, requestId))
    }
    if (route === 'settings/custom-fields' && method === 'GET') {
      requireRole(principal, ['ADMIN', 'STAFF'])
      const entityType = parseTemplateType(query.entityType)
      return response(200, { entityType, fields: await business.getCustomFieldDefinitions(entityType) })
    }
    if (segments[0] === 'settings' && segments[1] === 'custom-fields' && segments.length === 3
      && method === 'PUT') {
      requireRole(principal, ['ADMIN'])
      const entityType = parseTemplateType(segments[2])
      const body = objectBody(parsedBody)
      return response(200, {
        entityType,
        fields: await business.setTemplate(entityType, body.fields, principal.userId, requestId),
      })
    }
    if (route === 'staff' && method === 'GET') {
      requireRole(principal, ['ADMIN'])
      return response(200, await staff.list(query))
    }
    if (route === 'staff' && method === 'POST') {
      requireRole(principal, ['ADMIN'])
      return response(201, await staff.create(parsedBody, principal, requestId))
    }
    if (segments[0] === 'staff' && segments.length === 2 && method === 'PATCH') {
      requireRole(principal, ['ADMIN'])
      return response(200, await staff.update(segments[1], parsedBody, principal, requestId))
    }
    if (method === 'GET' && route === 'expenses') {
      requireRole(principal, ['ADMIN', 'STAFF'])
      return response(200, await financeRecords.list('EXPENSE', query))
    }
    if (method === 'POST' && route === 'expenses') {
      requireRole(principal, ['ADMIN', 'STAFF'])
      return response(201, await financeRecords.create('EXPENSE', parsedBody, principal, requestId))
    }
    if (method === 'PATCH' && segments[0] === 'expenses' && segments.length === 2) {
      requireRole(principal, ['ADMIN', 'STAFF'])
      return response(200, await financeRecords.update('EXPENSE', segments[1], parsedBody, principal, requestId))
    }
    if (method === 'GET' && route === 'investments') {
      requireRole(principal, ['ADMIN', 'STAFF'])
      return response(200, await financeRecords.list('INVESTMENT', query))
    }
    if (method === 'POST' && route === 'investments') {
      requireRole(principal, ['ADMIN', 'STAFF'])
      return response(201, await financeRecords.create('INVESTMENT', parsedBody, principal, requestId))
    }
    if (method === 'PATCH' && segments[0] === 'investments' && segments.length === 2) {
      requireRole(principal, ['ADMIN', 'STAFF'])
      return response(200, await financeRecords.update('INVESTMENT', segments[1], parsedBody, principal, requestId))
    }
    if (method === 'GET' && route === 'reports/summary') {
      requireRole(principal, ['ADMIN'])
      return response(200, await reports.summary(query.from, query.to))
    }
    if (route === 'audit' && method === 'GET') {
      requireRole(principal, ['ADMIN'])
      return response(200, await audit.list(query))
    }

    throw notFound('API route was not found.')
  } catch (error) {
    if (error instanceof AppError) {
      return response(error.statusCode, {
        error: { code: error.code, message: error.message, requestId },
      })
    }
    if (isMissingTable(error)) {
      console.error(JSON.stringify({ requestId, error: 'DYNAMODB_TABLE_NOT_FOUND' }))
      return response(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is not ready.', requestId } })
    }
    console.error(JSON.stringify({
      requestId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      ...(error instanceof Error && error.name === 'AccessDeniedException' ? { errorMessage: error.message } : {}),
    }))
    return response(500, {
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId },
    })
  }
}

function parseBody(event: APIGatewayProxyEventV2) {
  if (!event.body) return {}
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body, 'utf8')
  if (raw.byteLength > maxBodyBytes) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.')
  if (!raw.byteLength) return {}
  const contentType = event.headers['content-type'] ?? event.headers['Content-Type']
  if (contentType && !contentType.toLowerCase().startsWith('application/json')) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
  }
  if (!contentType) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
  try {
    return JSON.parse(raw.toString('utf8')) as unknown
  } catch {
    throw badRequest('Request body must contain valid JSON.')
  }
}

function objectBody(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Request body must be a JSON object.')
  }
  return body as Record<string, unknown>
}

async function authenticate(event: APIGatewayProxyEventV2): Promise<Principal> {
  const authorization = event.headers.authorization ?? event.headers.Authorization
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._-]+)$/)
  if (!match) throw unauthorized()
  return auth.authenticateToken(match[1])
}

function requireRole(principal: Principal, allowed: Principal['role'][]) {
  if (!allowed.includes(principal.role)) throw forbidden()
}

function parseTemplateType(value: string | undefined) {
  const type = value?.toUpperCase()
  if (type !== 'CUSTOMER' && type !== 'LOAN' && type !== 'STAFF') throw badRequest('entityType must be CUSTOMER, LOAN, or STAFF.')
  return type
}

function decodePath(rawPath: string) {
  try {
    return rawPath.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment))
  } catch {
    throw badRequest('Request path is invalid.')
  }
}

function response(statusCode: number, body?: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}
