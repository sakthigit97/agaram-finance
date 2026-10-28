import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, clearApiCache, mapCustomer, mapLoan, mapPayment } from './api'

afterEach(() => {
  clearApiCache()
  vi.unstubAllGlobals()
})

describe('API record mapping', () => {
  it('maps public customer, loan, and ledger records to the UI domain types', () => {
    expect(mapCustomer({
      customerId: 'cus_1',
      userId: 'cus_1',
      name: 'Meena',
      phone: '+919876543210',
      area: 'Anna Nagar',
      createdAt: '2026-10-25T10:00:00.000Z',
      customFields: { memberNumber: 42 },
    })).toMatchObject({
      id: 'cus_1',
      joinedOn: '2026-10-25',
      customFields: { memberNumber: 42 },
    })

    expect(mapLoan({
      loanId: 'loan_1',
      customerId: 'cus_1',
      type: 'MONTHLY',
      principalPaise: 1_000_000,
      upfrontInterestPaise: 0,
      bookFeePaise: 0,
      monthlyInterestPaise: 30_000,
      targetPaise: 1_000_000,
      collectedPaise: 0,
      interestCollectedPaise: 0,
      principalCollectedPaise: 0,
      status: 'ACTIVE',
      disbursedOn: '2026-10-01',
    })).toMatchObject({
      id: 'loan_1',
      type: 'Monthly',
      interestPaise: 30_000,
      status: 'Active',
    })

    expect(mapPayment({
      paymentId: 'rev_1',
      loanId: 'loan_1',
      customerId: 'cus_1',
      amountPaise: 500,
      interestComponentPaise: 100,
      principalComponentPaise: 400,
      receivedOn: '2026-10-25',
      method: 'BANK_TRANSFER',
      entryType: 'REVERSAL',
      reversedPaymentId: 'pay_1',
    })).toMatchObject({
      id: 'rev_1',
      method: 'Bank transfer',
      entryType: 'REVERSAL',
      reversedPaymentId: 'pay_1',
    })
  })
})

describe('API request handling', () => {
  it('sends bearer and idempotency headers for a loan creation request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ loanId: 'loan_1' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await api.createLoan('token-value', { customerId: 'cus_1' }, 'stable-operation-key')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/loans')
    expect(headers.get('Authorization')).toBe('Bearer token-value')
    expect(headers.get('Idempotency-Key')).toBe('stable-operation-key')
  })

  it('requests a server-generated one-time password for admin account resets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ temporaryPassword: 'one-time-value' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.resetPassword('admin-token', 'customer-1')).resolves.toEqual({
      temporaryPassword: 'one-time-value',
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/users/customer-1/password')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
  })

  it('updates agent profile details through the admin endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      staffId: 'staff_1',
      userId: 'staff_1',
      name: 'New Agent Name',
      phone: '9876543210',
      status: 'ACTIVE',
      createdAt: '2026-10-25T10:00:00.000Z',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.updateStaff('admin-token', 'staff_1', { name: 'New Agent Name', phone: '9876543210' }))
      .resolves.toMatchObject({ staffId: 'staff_1', name: 'New Agent Name' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/staff/staff_1')
    expect(init.method).toBe('PATCH')
    expect(init.body).toBe(JSON.stringify({ name: 'New Agent Name', phone: '9876543210' }))
  })

  it('surfaces API error codes and messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'UNAUTHORIZED', message: 'Sign in again.' },
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })))
    await expect(api.me('expired-token')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Sign in again.',
    })
  })

  it('surfaces readable error responses returned directly by an API gateway', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: 'A clear server-side validation message.',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })))
    await expect(api.me('token')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'A clear server-side validation message.',
    })
  })

  it('deduplicates concurrent GETs, caches a successful response briefly, and invalidates it after writes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        userId: 'admin_1', role: 'ADMIN', name: 'Admin', phone: '9876543210', passwordChangeRequired: false,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        staffId: 'staff_1', userId: 'staff_1', name: 'Agent', phone: '9876543210', status: 'ACTIVE', createdAt: '2026-10-25',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        userId: 'admin_1', role: 'ADMIN', name: 'Updated Admin', phone: '9876543210', passwordChangeRequired: false,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([api.me('token-1'), api.me('token-1')])
    await api.me('token-1')
    expect(fetchMock).toHaveBeenCalledOnce()

    await api.updateStaff('token-1', 'staff_1', { name: 'Agent', phone: '9876543210' })
    await api.me('token-1')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not reuse cached private API responses across different access tokens', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        userId: 'admin_1', role: 'ADMIN', name: 'Admin', phone: '9876543210', passwordChangeRequired: false,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        userId: 'customer_1', role: 'CUSTOMER', name: 'Customer', phone: '9876543211', passwordChangeRequired: false,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.me('admin-token')).resolves.toMatchObject({ userId: 'admin_1' })
    await expect(api.me('customer-token')).resolves.toMatchObject({ userId: 'customer_1' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
