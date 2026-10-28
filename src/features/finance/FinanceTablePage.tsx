import { ArrowLeft, ArrowRight, ChevronDown, Download, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Customer, FinanceAction, Loan, Payment } from '../../types/finance'
import { formatDate, formatMoney, getBusinessDate } from '../../lib/format'
import { getLoanOutstandingPaise } from '../../domain/loans'
import type { AuditRecord, BusinessSettings, CustomFieldDefinition, StaffRecord } from '../../lib/api'
import { CustomerEditDialog } from './CustomerEditDialog'
import { AdminPanel } from './AdminPanel'
import { LoanEditDialog } from './LoanEditDialog'
import { TransactionEditDialog } from './TransactionEditDialog'
import { LoanDetailsDialog } from './LoanDetailsDialog'

type PageKind = 'customers' | 'loans' | 'payments' | 'reports'

export function FinanceTablePage({
  title,
  description,
  kind,
  customers,
  loans,
  payments,
  customerNames,
  customerPhones,
  onCreate,
  canManage,
  nextCursor,
  onPageChange,
  collectionDate,
  onCollectionDateChange,
  canAdmin = false,
  settings,
  customerFields = [],
  loanFields = [],
  staffFields = [],
  staff = [],
  audit = [],
  onRefreshAdministration,
  onSaveSettings,
  onSaveTemplate,
  onCreateStaff,
  onResetPassword,
  onReversePayment,
  onUpdateCustomer,
  onUpdateLoan,
  onUpdatePayment,
  onLoadLoanPayments,
  onCheckLoanTransactions,
  onCollectLoan,
}: {
  title: string
  description: string
  kind: PageKind
  customers: Customer[]
  loans: Loan[]
  payments: Payment[]
  customerNames: Record<string, string>
  customerPhones: Record<string, string>
  onCreate: (action: FinanceAction) => void
  canManage: boolean
  nextCursor?: string
  onPageChange?: (cursor?: string) => void
  collectionDate?: string
  onCollectionDateChange?: (date: string) => void
  canAdmin?: boolean
  settings?: BusinessSettings | null
  customerFields?: CustomFieldDefinition[]
  loanFields?: CustomFieldDefinition[]
  staffFields?: CustomFieldDefinition[]
  staff?: StaffRecord[]
  audit?: AuditRecord[]
  onRefreshAdministration?: () => Promise<void>
  onSaveSettings?: (settings: Partial<Omit<BusinessSettings, 'version'>>) => Promise<void>
  onSaveTemplate?: (entityType: 'CUSTOMER' | 'LOAN' | 'STAFF', fields: CustomFieldDefinition[]) => Promise<void>
  onCreateStaff?: (staff: { name: string; phone: string; customFields?: Record<string, string | number | boolean> }) => Promise<string>
  onResetPassword?: (userId: string) => Promise<string>
  onReversePayment?: (loanId: string, paymentId: string) => Promise<void>
  onUpdateCustomer?: (customerId: string, input: Record<string, unknown>) => Promise<void>
  onUpdateLoan?: (loanId: string, input: Record<string, unknown>) => Promise<void>
  onUpdatePayment?: (loanId: string, paymentId: string, input: Record<string, unknown>) => Promise<void>
  onLoadLoanPayments?: (loanId: string, cursor?: string) => Promise<{ items: Payment[]; nextCursor?: string }>
  onCheckLoanTransactions?: (loanId: string) => Promise<boolean>
  onCollectLoan?: (loanId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null)
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [viewingLoan, setViewingLoan] = useState<Loan | null>(null)
  const [resetCredential, setResetCredential] = useState<{ customerId: string; password: string } | null>(null)
  const [resettingCustomerId, setResettingCustomerId] = useState('')
  const [resetError, setResetError] = useState('')
  const [pageCursors, setPageCursors] = useState<(string | undefined)[]>([undefined])
  const [today] = useState(getBusinessDate)
  const [year] = useState(() => new Date().getFullYear())
  const pageNumber = pageCursors.length
  async function resetCustomerPassword(customer: Customer) {
    if (!onResetPassword) return
    setResettingCustomerId(customer.id)
    setResetError('')
    setResetCredential(null)
    try {
      const password = await onResetPassword(customer.userId ?? customer.id)
      setResetCredential({ customerId: customer.id, password })
    } catch (cause) {
      setResetError(cause instanceof Error ? cause.message : 'Password reset could not be completed.')
    } finally {
      setResettingCustomerId('')
    }
  }
  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const digits = normalized.replace(/\D/g, '')
    const matches = (values: string[]) => values.some((value) => value.toLowerCase().includes(normalized)
      || (digits.length > 0 && value.replace(/\D/g, '').includes(digits)))
    if (kind === 'customers') return customers.filter((customer) => matches([customer.id, customer.name, customer.phone, customer.area]))
    if (kind === 'loans') return loans.filter((loan) => matches([loan.id, loan.customerId, loan.type, customerNames[loan.customerId] ?? '', customerPhones[loan.customerId] ?? '']))
    if (kind === 'payments') return payments.filter((payment) => {
      const customerId = loans.find((loan) => loan.id === payment.loanId)?.customerId ?? ''
      return matches([payment.id, payment.loanId, customerId, payment.method, customerNames[customerId] ?? '', customerPhones[customerId] ?? ''])
    })
    return loans.filter((loan) => loan.status === 'Active').filter((loan) => matches([loan.id, loan.customerId, loan.type, customerNames[loan.customerId] ?? '', customerPhones[loan.customerId] ?? '']))
  }, [customers, customerNames, customerPhones, kind, loans, payments, query])

  const action = kind === 'customers' ? 'customer' : kind === 'loans' ? 'loan' : 'payment'
  const buttonText = kind === 'customers' ? 'Add customer' : kind === 'loans' ? 'Create loan' : 'Record payment'
  function nextPage() {
    if (!nextCursor || !onPageChange) return
    setPageCursors((current) => [...current, nextCursor])
    onPageChange(nextCursor)
  }

  function previousPage() {
    if (pageCursors.length <= 1 || !onPageChange) return
    const updated = pageCursors.slice(0, -1)
    setPageCursors(updated)
    onPageChange(updated[updated.length - 1])
  }

  function exportCsv() {
    const fields = kind === 'customers'
      ? ['id', 'name', 'phone', 'area', 'joinedOn']
      : kind === 'loans' || kind === 'reports'
        ? ['id', 'customerId', 'type', 'principalPaise', 'collectedPaise', 'status', 'disbursedOn']
        : ['id', 'loanId', 'receivedOn', 'method', 'amountPaise', 'entryType']
    const source = rows.map((row) => Object.fromEntries(Object.entries(row)))
    const escapeCell = (value: unknown) => {
      const text = String(value ?? '')
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
      return `"${safe.replaceAll('"', '""')}"`
    }
    const csv = [fields.map(escapeCell).join(','), ...source.map((row) => fields.map((field) => escapeCell(row[field])).join(','))].join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${kind}-${collectionDate ?? today}-page-${pageNumber}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page-wrap">
      <header className="topbar">
        <div className="breadcrumb"><span>Workspace</span><span className="crumb-separator">/</span><strong>{title}</strong></div>
        <div className="topbar-actions"><span className="today-label">{formatDate(today)}</span></div>
      </header>
      <section className="welcome-row section-welcome">
        <div><div className="eyebrow">AGARAM FINANCE</div><h1>{title}</h1><p className="page-subtitle">{description}</p></div>
        {canManage && kind !== 'reports' && (kind === 'customers' && canAdmin
          ? <div className="account-create-menu">
            <button className="button button-primary" aria-haspopup="menu" aria-expanded={createMenuOpen} onClick={() => setCreateMenuOpen((open) => !open)}>
              <Plus size={17} /> Add account <ChevronDown size={15} />
            </button>
            {createMenuOpen && <div className="account-create-options" role="menu" aria-label="Choose account type">
              <button role="menuitem" onClick={() => { setCreateMenuOpen(false); onCreate('customer') }}>Customer</button>
              <button role="menuitem" onClick={() => { setCreateMenuOpen(false); onCreate('staff') }}>Agent</button>
            </div>}
          </div>
          : <button className="button button-primary" onClick={() => onCreate(action)}><Plus size={17} /> {buttonText}</button>)}
      </section>
      {kind === 'reports' && (
        <>
          <Link className="button button-secondary financial-report-link" to="/financial-reports">Open date-range financial reports <ArrowRight size={15} /></Link>
          <p className="data-scope-note">Totals reflect records shown on this page. Browse other pages to review more of your portfolio.</p>
          <div className="report-insight">
            <div className="metric-card"><span>Outstanding balance</span><strong>{formatMoney(loans.filter((loan) => loan.status === 'Active').reduce((sum, loan) => sum + getLoanOutstandingPaise(loan, today), 0))}</strong></div>
            <div className="metric-card"><span>Collections shown</span><strong>{formatMoney(payments.filter((payment) => payment.entryType !== 'REVERSAL').reduce((sum, payment) => sum + payment.amountPaise, 0))}</strong></div>
            <div className="metric-card"><span>Customers shown</span><strong>{customers.length}</strong></div>
          </div>
        </>
      )}
      <section className="panel list-panel">
        <div className="list-toolbar">
          <div><h2>{kind === 'customers' ? 'Customers' : kind === 'loans' ? 'Loans' : kind === 'payments' ? 'Collection ledger' : 'Active accounts'}</h2><p>{rows.length} records on page {pageNumber}</p></div>
          <div className="table-controls">
            {kind === 'payments' && onCollectionDateChange && <label className="date-filter">Payment date<input type="date" value={collectionDate} onChange={(event) => { setPageCursors([undefined]); onCollectionDateChange(event.target.value) }} max={today} /></label>}
            <label className="search-input"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={kind === 'customers' ? 'Filter this page by ID, name, or mobile...' : kind === 'loans' || kind === 'reports' ? 'Filter this page by loan ID, name, or mobile...' : 'Filter this page by transaction, loan, name, or mobile...'} /></label>
            <button className="select-button" onClick={exportCsv}><Download size={15} /> Export page</button>
          </div>
        </div>
        <div className="table-scroll">
          {kind === 'customers' ? (
            <table><thead><tr><th>Customer</th><th>Mobile number</th><th>Area</th><th>Active loans</th><th>Customer since</th><th>Account</th>{canAdmin && <th>Actions</th>}</tr></thead><tbody>
              {(rows as Customer[]).map((customer) => <tr key={customer.id}><td><div className="customer-cell"><span className="table-avatar">{initials(customer.name)}</span><span><strong>{customer.name}</strong><small>{customer.id}</small></span></div></td><td>{customer.phone}</td><td>{customer.area}</td><td>{loans.filter((loan) => loan.customerId === customer.id && loan.status === 'Active').length}</td><td>{formatDate(customer.joinedOn)}</td><td><span className="status-pill status-complete"><span /> Active</span></td>{canAdmin && <td><button className="text-action" onClick={() => setEditingCustomer(customer)}>Edit</button><button className="text-action" disabled={resettingCustomerId === customer.id} onClick={() => void resetCustomerPassword(customer)}>{resettingCustomerId === customer.id ? 'Resetting…' : 'Reset access'}</button>{resetCredential?.customerId === customer.id && <div className="temporary-credential"><span>One-time password</span><output>{resetCredential.password}</output><button className="text-action" onClick={() => setResetCredential(null)}>Dismiss</button></div>}</td>}</tr>)}
            </tbody></table>
          ) : kind === 'loans' || kind === 'reports' ? (
            <table><thead><tr><th>Loan ID</th><th>Customer</th><th>Mobile</th><th>Type</th><th>Nominal amount</th><th>Disbursed</th><th>Collected</th><th>Balance due</th><th>Status</th>{kind === 'loans' && <th>Actions</th>}</tr></thead><tbody>
              {(rows as Loan[]).map((loan) => {
                const disbursedPaise = loan.type === 'Monthly' ? loan.principalPaise : loan.principalPaise - loan.interestPaise - loan.feePaise
                return <tr key={loan.id}><td className="id-cell">{loan.id}</td><td><strong>{customerNames[loan.customerId] ?? 'Unknown customer'}</strong></td><td>{customerPhones[loan.customerId] ?? ''}</td><td><span className={`loan-type type-${loan.type.toLowerCase()}`}>{loan.type}</span></td><td>{formatMoney(loan.principalPaise)}</td><td>{formatMoney(disbursedPaise)}</td><td>{formatMoney(loan.collectedPaise)}</td><td className="amount-cell">{formatMoney(getLoanOutstandingPaise(loan, today))}</td><td><span className={`status-pill ${loan.status === 'Paid' ? 'status-complete' : 'status-active'}`}><span />{loan.status}</span></td>{kind === 'loans' && <td><button className="text-action" onClick={() => setViewingLoan(loan)}>Details</button>{canAdmin && <button className="text-action" onClick={() => setEditingLoan(loan)}>Edit</button>}</td>}</tr>
              })}
            </tbody></table>
          ) : (
            <table><thead><tr><th>Entry ID</th><th>Customer</th><th>Mobile</th><th>Loan ID</th><th>Date</th><th>Method</th><th>Amount</th><th>Entry type</th>{canAdmin && <th>Action</th>}</tr></thead><tbody>
              {(rows as Payment[]).map((payment) => { const customerId = loans.find((loan) => loan.id === payment.loanId)?.customerId ?? ''; return <tr key={payment.id}><td className="id-cell">{payment.id}</td><td><strong>{customerNames[customerId] ?? 'Unknown customer'}</strong></td><td>{customerPhones[customerId] ?? ''}</td><td>{payment.loanId}</td><td>{formatDate(payment.receivedOn)}</td><td>{payment.method}</td><td className="amount-cell">{formatMoney(payment.amountPaise)}</td><td><span className={`status-pill ${payment.entryType === 'REVERSAL' ? 'status-reversed' : 'status-complete'}`}><span />{payment.entryType === 'REVERSAL' ? `Reversal${payment.reversedPaymentId ? ` · ${payment.reversedPaymentId}` : ''}` : 'Payment'}</span></td>{canAdmin && <td>{payment.entryType !== 'REVERSAL' && <><button className="text-action" onClick={() => setEditingPayment(payment)}>Edit</button> <button className="text-action" onClick={() => { if (window.confirm(`Reverse transaction ${payment.id}? This adds an immutable reversal entry.`)) void onReversePayment?.(payment.loanId, payment.id) }}>Reverse</button></>}</td>}</tr> })}
            </tbody></table>
          )}
          {rows.length === 0 && <div className="empty-state">{query ? 'No matches on this page. Clear the search or browse another page.' : 'No records found for this view.'}</div>}
        </div>
        <div className="list-footer"><span>Showing <strong>{rows.length}</strong> records · page {pageNumber}</span><div><button onClick={previousPage} disabled={pageNumber === 1}><ArrowLeft size={13} /> Previous</button><span className="current-page">{pageNumber}</span><button onClick={nextPage} disabled={!nextCursor}><ArrowRight size={13} /> Next</button></div></div>
      </section>
      {kind === 'reports' && canAdmin && <AdminPanel
        settings={settings}
        customerFields={customerFields}
        loanFields={loanFields}
        staffFields={staffFields}
        staff={staff}
        audit={audit}
        onRefresh={onRefreshAdministration}
        onSaveSettings={onSaveSettings}
        onSaveTemplate={onSaveTemplate}
        onCreateStaff={onCreateStaff}
        onResetPassword={onResetPassword}
      />}
      {editingCustomer && <CustomerEditDialog customer={editingCustomer} definitions={customerFields} onClose={() => setEditingCustomer(null)} onSave={async (customerId, input) => { await onUpdateCustomer?.(customerId, input); setEditingCustomer(null) }} />}
      {resetError && <div className="form-error" role="alert">{resetError}</div>}
      {editingLoan && onCheckLoanTransactions && <LoanEditDialog key={editingLoan.id} loan={editingLoan} definitions={loanFields} hasTransactions={editingLoan.collectedPaise > 0 || payments.some((payment) => payment.loanId === editingLoan.id)} onCheckTransactions={onCheckLoanTransactions} onClose={() => setEditingLoan(null)} onSave={async (loanId, input) => { await onUpdateLoan?.(loanId, input); setEditingLoan(null) }} />}
      {editingPayment && <TransactionEditDialog payment={editingPayment} onClose={() => setEditingPayment(null)} onSave={async (loanId, paymentId, input) => { await onUpdatePayment?.(loanId, paymentId, input); setEditingPayment(null) }} />}
      {viewingLoan && onLoadLoanPayments && <LoanDetailsDialog key={viewingLoan.id} loan={viewingLoan} customerName={customerNames[viewingLoan.customerId] ?? 'Customer'} customerPhone={customerPhones[viewingLoan.customerId] ?? ''} today={today} canCollect={canManage} onLoadPayments={onLoadLoanPayments} onCollect={(loanId) => { setViewingLoan(null); onCollectLoan?.(loanId) }} onClose={() => setViewingLoan(null)} />}
      <footer className="page-footer"><span>© {year} Agaram Finance</span></footer>
    </div>
  )
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}
