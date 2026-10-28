import { ArrowDownLeft, ArrowRight, Plus, RefreshCw, UsersRound, Wallet } from 'lucide-react'
import { useState } from 'react'
import type { ApiPrincipal } from '../../lib/api'
import type { Customer, FinanceAction, Loan, Payment } from '../../types/finance'
import { formatDate, formatMoney, getBusinessDate } from '../../lib/format'
import { getLoanOutstandingPaise } from '../../domain/loans'

export function Dashboard({
  customers,
  loans,
  payments,
  onCreate,
  principal,
  onRefresh,
}: {
  customers: Customer[]
  loans: Loan[]
  payments: Payment[]
  onCreate: (action: FinanceAction) => void
  principal: ApiPrincipal
  onRefresh: () => void
}) {
  const [today] = useState(getBusinessDate)
  const [year] = useState(() => new Date().getFullYear())
  const activeLoans = loans.filter((loan) => loan.status === 'Active')
  const totalOutstanding = activeLoans.reduce((sum, loan) => sum + getLoanOutstandingPaise(loan, today), 0)
  const todaysPayments = payments.filter((payment) => payment.receivedOn === today && payment.entryType !== 'REVERSAL')
  const collectionToday = todaysPayments.reduce((sum, payment) => sum + payment.amountPaise, 0)
  const canManage = principal.role === 'ADMIN' || principal.role === 'STAFF'

  return (
    <div className="page-wrap">
      <header className="topbar">
        <div className="breadcrumb"><span>Workspace</span><span className="crumb-separator">/</span><strong>Overview</strong></div>
        <div className="topbar-actions"><span className="today-label">{formatDate(today)}</span><button className="icon-button" aria-label="Refresh finance data" onClick={onRefresh}><RefreshCw size={16} /></button></div>
      </header>

      <section className="welcome-row">
        <div>
          <div className="eyebrow">{formatDate(today)}</div>
          <h1>Welcome, {principal.name}</h1>
          <p className="page-subtitle">Your finance activity at a glance.</p>
        </div>
        {canManage && <button className="button button-primary" onClick={() => onCreate('payment')}><Plus size={17} /> Record a payment</button>}
      </section>

      <section className="metric-grid" aria-label="Loaded portfolio summary">
        <MetricCard label="Outstanding balance" value={formatMoney(totalOutstanding)} icon={<Wallet size={18} />} foot={`${activeLoans.length} active loans shown`} color="violet" />
        <MetricCard label="Collected today" value={formatMoney(collectionToday)} icon={<ArrowDownLeft size={18} />} foot={`${todaysPayments.length} transactions`} color="green" />
        <MetricCard label="Active loans" value={String(activeLoans.length)} icon={<Wallet size={18} />} foot="Current page" color="blue" />
        <MetricCard label="Customers" value={String(customers.length)} icon={<UsersRound size={18} />} foot="Current page" color="amber" />
      </section>
      <p className="data-scope-note">Summary figures reflect the records shown here. Visit Customers, Loans, and Collections to review complete lists.</p>

      <section className="dashboard-grid">
        <article className="panel performance-panel">
          <div className="panel-heading"><div><h2>Recent collections</h2><p>Payments received today.</p></div></div>
          <div className="activity-mini-list">
            {payments.slice(0, 6).map((payment) => {
              const loan = loans.find((item) => item.id === payment.loanId)
              const customer = customers.find((item) => item.id === loan?.customerId)
              return <div className="mini-row" key={payment.id}><span className="mini-icon mint"><ArrowDownLeft size={15} /></span><span><strong>{customer?.name ?? 'Customer'} · {payment.entryType === 'REVERSAL' ? 'Reversal' : 'Payment'}</strong><small>{payment.id} · {formatDate(payment.receivedOn)}</small></span><span className="mini-value">{formatMoney(payment.amountPaise)}</span></div>
            })}
            {payments.length === 0 && <div className="empty-state">No collections have been recorded today.</div>}
          </div>
        </article>
        <article className="panel today-panel">
          <div className="panel-heading"><div><h2>Account overview</h2><p>Your account summary</p></div></div>
          <div className="today-total"><span>{principal.role}</span><span className="today-progress">Signed in</span></div>
          <div className="today-divider" />
          <div className="mini-list">
            <div className="mini-row"><span className="mini-icon mint"><UsersRound size={15} /></span><span><strong>{customers.length} customers shown</strong><small>Current page</small></span></div>
            <div className="mini-row"><span className="mini-icon sand"><Wallet size={15} /></span><span><strong>{loans.length} loans shown</strong><small>Current page</small></span></div>
          </div>
          {canManage && <button className="button button-secondary full-button" onClick={() => onCreate('customer')}>Add a customer <ArrowRight size={15} /></button>}
        </article>
      </section>
      <footer className="page-footer"><span>© {year} Agaram Finance</span></footer>
    </div>
  )
}

function MetricCard({
  label,
  value,
  icon,
  foot,
  color,
}: {
  label: string
  value: string
  icon: React.ReactNode
  foot: string
  color: string
}) {
  return (
    <article className="metric-card">
      <div className="metric-top"><span>{label}</span><span className={`metric-icon ${color}`}>{icon}</span></div>
      <div className="metric-value">{value}</div>
      <div className="metric-bottom"><span>{foot}</span></div>
    </article>
  )
}
