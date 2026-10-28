import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppSidebar } from './components/AppSidebar'
import { Dashboard } from './features/dashboard/Dashboard'
import { AuthScreen } from './features/auth/AuthScreen'
import { ChangePasswordDialog } from './features/auth/ChangePasswordDialog'
import { FinanceTablePage } from './features/finance/FinanceTablePage'
import { AgentsPage } from './features/finance/AgentsPage'
import { CashRecordsPage } from './features/finance/CashRecordsPage'
import { FinanceReportsPage } from './features/finance/FinanceReportsPage'
import { QuickActionDialog } from './features/finance/QuickActionDialog'
import { getBusinessDate } from './lib/format'
import { clearSessionToken, readSessionToken, saveSessionToken } from './lib/session'
import { api, ApiError, clearApiCache, mapCustomer, mapLoan, mapPayment, type ApiPrincipal, type AuditRecord, type BusinessSettings, type CustomFieldDefinition, type ExpenseRecord, type FinanceReportSummary, type InvestmentRecord, type Page, type StaffRecord } from './lib/api'
import type { Customer, FinanceAction, Loan, Payment } from './types/finance'
import './App.css'

function AppLayout() {
  const loadGeneration = useRef(0)
  const [initialSessionStorage] = useState(() => readSessionToken())
  const [session, setSession] = useState<{ token: string; principal: ApiPrincipal } | null>(null)
  const [authReady, setAuthReady] = useState(() => !initialSessionStorage.ok || !initialSessionStorage.token)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loans, setLoans] = useState<Loan[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [action, setAction] = useState<FinanceAction | null>(null)
  const [selectedPaymentLoanId, setSelectedPaymentLoanId] = useState<string>()
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [customerFields, setCustomerFields] = useState<CustomFieldDefinition[]>([])
  const [loanFields, setLoanFields] = useState<CustomFieldDefinition[]>([])
  const [staffFields, setStaffFields] = useState<CustomFieldDefinition[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(() => initialSessionStorage.ok ? '' : 'Browser storage is unavailable. Your sign-in will not survive a page refresh.')
  const [customerCursor, setCustomerCursor] = useState<string>()
  const [loanCursor, setLoanCursor] = useState<string>()
  const [paymentCursor, setPaymentCursor] = useState<string>()
  const [collectionDate, setCollectionDate] = useState(getBusinessDate())
  const initialCollectionDate = useRef(collectionDate)
  const [settings, setSettings] = useState<BusinessSettings | null>(null)
  const [staff, setStaff] = useState<StaffRecord[]>([])
  const [audit, setAudit] = useState<AuditRecord[]>([])
  const canManage = session?.principal.role === 'ADMIN' || session?.principal.role === 'STAFF'

  useEffect(() => {
    if (!initialSessionStorage.ok || !initialSessionStorage.token) return
    const token = initialSessionStorage.token

    let active = true
    void api.me(token).then((principal) => {
      if (!active) return
      if (principal.passwordChangeRequired) {
        const cleared = clearSessionToken()
        setError(cleared
          ? 'Your password must be changed. Sign in again to continue.'
          : 'Your password must be changed. Sign in again to continue; the saved session could not be cleared from browser storage.')
      } else {
        setSession({ token, principal })
      }
    }).catch((cause: unknown) => {
      if (!active) return
      if (cause instanceof ApiError && cause.status === 401) {
        const cleared = clearSessionToken()
        setError(cleared
          ? 'Your session has expired. Please sign in again.'
          : 'Your session has expired. Please sign in again; the saved session could not be cleared from browser storage.')
      } else {
        setError(cause instanceof Error ? `Saved session could not be verified: ${cause.message}` : 'Saved session could not be verified.')
      }
    }).finally(() => {
      if (active) setAuthReady(true)
    })

    return () => { active = false }
  }, [initialSessionStorage])

  const customerNames = useMemo(
    () => Object.fromEntries(customers.map((customer) => [customer.id, customer.name])),
    [customers],
  )
  const customerPhones = useMemo(
    () => Object.fromEntries(customers.map((customer) => [customer.id, customer.phone])),
    [customers],
  )

  const clearSession = useCallback(() => {
    loadGeneration.current += 1
    const cleared = clearSessionToken()
    clearApiCache()
    setSession(null)
    setCustomers([])
    setLoans([])
    setPayments([])
    setStaff([])
    setAudit([])
    setSettings(null)
    setError(cleared ? '' : 'Signed out, but the saved session could not be cleared from browser storage. Close this tab to end the session.')
    return cleared
  }, [])

  const handleApiFailure = useCallback((cause: unknown, fallback: string) => {
    if (cause instanceof ApiError && cause.status === 401) {
      const cleared = clearSession()
      setError(cleared
        ? 'Your session has expired. Please sign in again.'
        : 'Your session has expired. Please sign in again; the saved session could not be cleared from browser storage.')
      return
    }
    setError(cause instanceof Error ? cause.message : fallback)
  }, [clearSession])

  const withSession = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation()
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        handleApiFailure(cause, 'Your request could not be completed.')
      }
      throw cause
    }
  }, [handleApiFailure])

  const loadData = useCallback(async (token: string, principal: ApiPrincipal) => {
    const generation = ++loadGeneration.current
    await Promise.resolve()
    setLoading(true)
    setError('')
    try {
      if (principal.role === 'CUSTOMER') {
        if (!principal.customerId) throw new Error('This customer account is missing its customer profile link.')
        const [customer, loanPage] = await Promise.all([
          api.customer(token, principal.customerId),
          api.loans(token),
        ])
        const mappedLoans = loanPage.items.map(mapLoan)
        const paymentLoans = mappedLoans.slice(0, 5)
        const paymentPages = await Promise.all(paymentLoans.map((loan) => api.loanPayments(token, loan.id, undefined, 10)))
        if (generation !== loadGeneration.current) return
        setCustomers([mapCustomer(customer)])
        setLoans(mappedLoans)
        setPayments(paymentPages.flatMap((page) => page.items.map(mapPayment)))
        setLoanCursor(loanPage.nextCursor)
        setCustomerCursor(undefined)
        setPaymentCursor(undefined)
      } else {
        const [customerPage, loanPage, paymentPage, customerTemplate, loanTemplate, staffTemplate, businessSettings, staffPage, auditPage] = await Promise.all([
          api.customers(token),
          api.loans(token),
          api.collections(token, initialCollectionDate.current),
          api.customerTemplate(token),
          api.loanTemplate(token),
          api.staffTemplate(token),
          principal.role === 'ADMIN' ? api.settings(token) : Promise.resolve(null),
          principal.role === 'ADMIN' ? api.staff(token) : Promise.resolve(null),
          principal.role === 'ADMIN' ? api.audit(token) : Promise.resolve(null),
        ])
        if (generation !== loadGeneration.current) return
        setCustomers(customerPage.items.map(mapCustomer))
        setLoans(loanPage.items.map(mapLoan))
        setPayments(paymentPage.items.map(mapPayment))
        setCustomerCursor(customerPage.nextCursor)
        setLoanCursor(loanPage.nextCursor)
        setPaymentCursor(paymentPage.nextCursor)
        setCustomerFields(customerTemplate.fields)
        setLoanFields(loanTemplate.fields)
        setStaffFields(staffTemplate.fields)
        setSettings(businessSettings)
        if (staffPage) setStaff(staffPage.items)
        if (auditPage) setAudit(auditPage.items)
      }
    } catch (cause) {
      if (generation !== loadGeneration.current) return
      if (cause instanceof ApiError && cause.status === 401) {
        const cleared = clearSession()
        setError(cleared
          ? 'Your session has expired. Please sign in again.'
          : 'Your session has expired. Please sign in again; the saved session could not be cleared from browser storage.')
      } else {
        setError(cause instanceof Error ? cause.message : 'Finance data could not be loaded.')
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }, [clearSession])

  useEffect(() => {
    if (session) void Promise.resolve().then(() => loadData(session.token, session.principal))
  }, [session, loadData])

  const loadCustomerPage = useCallback(async (cursor?: string) => {
    if (!session) return
    try {
      const page = await api.customers(session.token, cursor)
      setCustomers(page.items.map(mapCustomer))
      setCustomerCursor(page.nextCursor)
    } catch (cause) {
      handleApiFailure(cause, 'Customers could not be loaded.')
    }
  }, [session, handleApiFailure])

  const loadLoanPage = useCallback(async (cursor?: string) => {
    if (!session) return
    try {
      const page = await api.loans(session.token, cursor)
      setLoans(page.items.map(mapLoan))
      setLoanCursor(page.nextCursor)
    } catch (cause) {
      handleApiFailure(cause, 'Loans could not be loaded.')
    }
  }, [session, handleApiFailure])

  const loadPaymentPage = useCallback(async (cursor?: string) => {
    if (!session || session.principal.role === 'CUSTOMER') return
    try {
      const page = await api.collections(session.token, collectionDate, cursor)
      setPayments(page.items.map(mapPayment))
      setPaymentCursor(page.nextCursor)
    } catch (cause) {
      handleApiFailure(cause, 'Collections could not be loaded.')
    }
  }, [session, collectionDate, handleApiFailure])

  const loadLoanPayments = useCallback(async (loanId: string, cursor?: string) => {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    const page = await withSession(() => api.loanPayments(session.token, loanId, cursor, 25))
    return { items: page.items.map(mapPayment), nextCursor: page.nextCursor }
  }, [session, withSession])

  const checkLoanTransactions = useCallback(async (loanId: string) => {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    const page = await withSession(() => api.loanPayments(session.token, loanId, undefined, 1))
    return page.items.length > 0 || Boolean(page.nextCursor)
  }, [session, withSession])

  async function createCustomer(input: Record<string, unknown>) {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    const result = await withSession(() => api.createCustomer(session.token, input))
    const customer = mapCustomer(result.customer)
    setCustomers((current) => [customer, ...current])
    return result.temporaryPassword
  }

  async function updateCustomer(customerId: string, input: Record<string, unknown>) {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    const updated = mapCustomer(await withSession(() => api.updateCustomer(session.token, customerId, input)))
    setCustomers((current) => current.map((customer) => customer.id === customerId ? updated : customer))
    await refreshAdministration()
  }

  async function updateLoan(loanId: string, input: Record<string, unknown>) {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    const updated = mapLoan(await withSession(() => api.updateLoan(session.token, loanId, input)))
    setLoans((current) => current.map((loan) => loan.id === loanId ? updated : loan))
    await refreshAdministration()
  }

  async function updatePayment(loanId: string, paymentId: string, input: Record<string, unknown>) {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    const result = await withSession(() => api.updatePayment(session.token, loanId, paymentId, input))
    const updatedPayment = mapPayment(result.payment)
    const updatedLoan = mapLoan(result.loan)
    setPayments((current) => current.map((payment) => payment.id === paymentId ? updatedPayment : payment))
    setLoans((current) => current.map((loan) => loan.id === loanId ? updatedLoan : loan))
    await refreshAdministration()
  }

  async function createLoan(input: Record<string, unknown>, idempotencyKey: string) {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    const loan = mapLoan(await withSession(() => api.createLoan(session.token, input, idempotencyKey)))
    setLoans((current) => [loan, ...current])
  }

  async function recordPayment(loanId: string, input: Record<string, unknown>, idempotencyKey: string) {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    await withSession(() => api.recordPayment(session.token, loanId, input, idempotencyKey))
    await Promise.all([loadLoanPage(), loadPaymentPage()])
  }

  async function refreshAdministration() {
    if (!session || session.principal.role !== 'ADMIN') return
    const [staffPage, auditPage] = await withSession(() => Promise.all([api.staff(session.token), api.audit(session.token)]))
    setStaff(staffPage.items)
    setAudit(auditPage.items)
  }

  async function saveSettings(input: Partial<Omit<BusinessSettings, 'version'>>) {
    if (!session) return
    setSettings(await withSession(() => api.updateSettings(session.token, input)))
  }

  async function saveTemplate(entityType: 'CUSTOMER' | 'LOAN' | 'STAFF', fields: CustomFieldDefinition[]) {
    if (!session) return
    const result = await withSession(() => api.saveTemplate(session.token, entityType, fields))
    if (entityType === 'CUSTOMER') setCustomerFields(result.fields)
    else if (entityType === 'LOAN') setLoanFields(result.fields)
    else setStaffFields(result.fields)
  }

  async function createStaff(input: { name: string; phone: string; customFields?: Record<string, string | number | boolean> }) {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    const result = await withSession(() => api.createStaff(session.token, input))
    setStaff((current) => [result.staff, ...current])
    return result.temporaryPassword
  }

  async function updateStaff(staffId: string, input: { name?: string; phone?: string; customFields?: Record<string, string | number | boolean | null> }) {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    const updated = await withSession(() => api.updateStaff(session.token, staffId, input))
    setStaff((current) => current.map((member) => member.staffId === staffId ? updated : member))
    void refreshAdministration().catch((cause: unknown) => {
      handleApiFailure(cause, 'Agent records could not be refreshed.')
    })
  }

  const loadExpenses = useCallback(async (from: string, to: string, cursor?: string): Promise<Page<ExpenseRecord | InvestmentRecord>> => {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    return withSession(() => api.expenses(session.token, from, to, cursor))
  }, [session, withSession])

  const createExpense = useCallback(async (input: Record<string, unknown>) => {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    return withSession(() => api.createExpense(session.token, {
      date: String(input.date ?? ''),
      amountPaise: Number(input.amountPaise),
      reason: String(input.reason ?? ''),
      comments: String(input.comments ?? ''),
      ...(typeof input.agentId === 'string' && input.agentId ? { agentId: input.agentId } : {}),
    }))
  }, [session, withSession])

  const updateExpense = useCallback(async (recordId: string, input: Record<string, unknown>) => {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    const body: Partial<Pick<ExpenseRecord, 'date' | 'amountPaise' | 'reason' | 'comments' | 'agentId'>> = {}
    if (typeof input.date === 'string') body.date = input.date
    if (typeof input.amountPaise === 'number') body.amountPaise = input.amountPaise
    if (typeof input.reason === 'string') body.reason = input.reason
    if (typeof input.comments === 'string') body.comments = input.comments
    if (typeof input.agentId === 'string') body.agentId = input.agentId
    return withSession(() => api.updateExpense(session.token, recordId, body))
  }, [session, withSession])

  const loadInvestments = useCallback(async (from: string, to: string, cursor?: string): Promise<Page<ExpenseRecord | InvestmentRecord>> => {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    return withSession(() => api.investments(session.token, from, to, cursor))
  }, [session, withSession])

  const createInvestment = useCallback(async (input: Record<string, unknown>) => {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    return withSession(() => api.createInvestment(session.token, {
      date: String(input.date ?? ''),
      amountPaise: Number(input.amountPaise),
      investorName: String(input.investorName ?? ''),
      comments: String(input.comments ?? ''),
    }))
  }, [session, withSession])

  const updateInvestment = useCallback(async (recordId: string, input: Record<string, unknown>) => {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    const body: Partial<Pick<InvestmentRecord, 'date' | 'amountPaise' | 'investorName' | 'comments'>> = {}
    if (typeof input.date === 'string') body.date = input.date
    if (typeof input.amountPaise === 'number') body.amountPaise = input.amountPaise
    if (typeof input.investorName === 'string') body.investorName = input.investorName
    if (typeof input.comments === 'string') body.comments = input.comments
    return withSession(() => api.updateInvestment(session.token, recordId, body))
  }, [session, withSession])

  const loadReportSummary = useCallback(async (from: string, to: string): Promise<FinanceReportSummary> => {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    return withSession(() => api.reportSummary(session.token, from, to))
  }, [session, withSession])

  async function resetPassword(userId: string) {
    if (!session) throw new Error('Your session has expired. Sign in again.')
    const result = await withSession(() => api.resetPassword(session.token, userId))
    await refreshAdministration()
    return result.temporaryPassword
  }

  function collectFromLoan(loanId: string) {
    setSelectedPaymentLoanId(loanId)
    setAction('payment')
  }

  async function reversePayment(loanId: string, paymentId: string) {
    if (!session) return
    await withSession(() => api.reversePayment(session.token, loanId, paymentId))
    await loadData(session.token, session.principal)
  }

  if (!authReady) {
    return <main className="auth-screen"><section className="auth-card"><p className="auth-description">Verifying your secure session…</p></section></main>
  }

  if (!session) {
    return <AuthScreen initialError={error} onAuthenticated={(token, principal) => {
      setCustomers([])
      setLoans([])
      setPayments([])
      setCustomerFields([])
      setLoanFields([])
      setStaff([])
      setAudit([])
      setSettings(null)
      const saved = saveSessionToken(token)
      setError(saved ? '' : 'Signed in, but browser storage is unavailable. A page refresh will require you to sign in again.')
      setSession({ token, principal })
    }} />
  }

  return (
    <div className="app-shell">
      <AppSidebar
        onCreate={setAction}
        onLogout={clearSession}
        onChangePassword={() => setChangePasswordOpen(true)}
        principal={session.principal}
        canManage={canManage}
        canAdmin={session.principal.role === 'ADMIN'}
      />
      <main className="main-content">
        {error && <div className="app-alert" role="alert"><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
        {loading && <div className="loading-bar" role="status">Loading your workspace…</div>}
        <Routes>
          <Route path="/" element={session.principal.role === 'STAFF'
            ? <Navigate to="/customers" replace />
            : <Dashboard customers={customers} loans={loans} payments={payments} onCreate={setAction} principal={session.principal} onRefresh={() => void loadData(session.token, session.principal)} />} />
          <Route path="/customers" element={canManage
            ? <FinanceTablePage title="Customers" description="Customer accounts and contact details." kind="customers" customers={customers} loans={loans} payments={payments} customerNames={customerNames} customerPhones={customerPhones} onCreate={setAction} canManage={canManage} canAdmin={session.principal.role === 'ADMIN'} nextCursor={customerCursor} onPageChange={loadCustomerPage} customerFields={customerFields} onUpdateCustomer={updateCustomer} onResetPassword={resetPassword} />
            : <Navigate to="/loans" replace />} />
          <Route path="/loans" element={<FinanceTablePage title="Loans" description="Loan balances, repayment schedules, and transaction history." kind="loans" customers={customers} loans={loans} payments={payments} customerNames={customerNames} customerPhones={customerPhones} onCreate={setAction} canManage={canManage} canAdmin={session.principal.role === 'ADMIN'} nextCursor={loanCursor} onPageChange={loadLoanPage} onUpdateLoan={updateLoan} onLoadLoanPayments={loadLoanPayments} onCheckLoanTransactions={checkLoanTransactions} onCollectLoan={collectFromLoan} />} />
          <Route path="/collections" element={canManage
            ? <FinanceTablePage title="Collections" description="A clear ledger of payments received from customers." kind="payments" customers={customers} loans={loans} payments={payments} customerNames={customerNames} customerPhones={customerPhones} onCreate={setAction} canManage={canManage} canAdmin={session.principal.role === 'ADMIN'} nextCursor={paymentCursor} onPageChange={loadPaymentPage} collectionDate={collectionDate} onCollectionDateChange={setCollectionDate} onReversePayment={reversePayment} onUpdatePayment={updatePayment} />
            : <Navigate to="/loans" replace />} />
          <Route path="/reports" element={session.principal.role === 'ADMIN'
            ? <FinanceTablePage title="Reports" description="Portfolio performance and account activity." kind="reports" customers={customers} loans={loans} payments={payments} customerNames={customerNames} customerPhones={customerPhones} onCreate={setAction} canManage={canManage} canAdmin={session.principal.role === 'ADMIN'} settings={settings} customerFields={customerFields} loanFields={loanFields} staffFields={staffFields} staff={staff} audit={audit} onRefreshAdministration={refreshAdministration} onSaveSettings={saveSettings} onSaveTemplate={saveTemplate} onCreateStaff={createStaff} onResetPassword={resetPassword} />
            : <Navigate to="/" replace />} />
          <Route path="/expenses" element={canManage
            ? <CashRecordsPage kind="expenses" staff={staff} userId={session.principal.userId} userName={session.principal.name} isAdmin={session.principal.role === 'ADMIN'} onLoad={loadExpenses} onCreate={createExpense} onUpdate={updateExpense} />
            : <Navigate to="/" replace />} />
          <Route path="/investments" element={canManage
            ? <CashRecordsPage kind="investments" staff={staff} userId={session.principal.userId} userName={session.principal.name} isAdmin={session.principal.role === 'ADMIN'} onLoad={loadInvestments} onCreate={createInvestment} onUpdate={updateInvestment} />
            : <Navigate to="/" replace />} />
          <Route path="/financial-reports" element={session.principal.role === 'ADMIN'
            ? <FinanceReportsPage onLoad={loadReportSummary} />
            : <Navigate to="/" replace />} />
          <Route path="/agents" element={session.principal.role === 'ADMIN'
            ? <AgentsPage staff={staff} definitions={staffFields} onCreate={() => setAction('staff')} onUpdate={updateStaff} onResetPassword={resetPassword} />
            : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {action && canManage && (
        <QuickActionDialog
          action={action}
          customers={customers}
          loans={loans}
          customerFields={customerFields}
          loanFields={loanFields}
          staffFields={staffFields}
          onClose={() => { setAction(null); setSelectedPaymentLoanId(undefined) }}
          onCreateCustomer={createCustomer}
          onCreateStaff={createStaff}
          onCreateLoan={createLoan}
          onRecordPayment={recordPayment}
          initialLoanId={selectedPaymentLoanId}
        />
      )}
      {changePasswordOpen && <ChangePasswordDialog token={session.token} onClose={() => setChangePasswordOpen(false)} />}
    </div>
  )

}

function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  )
}

export default App
