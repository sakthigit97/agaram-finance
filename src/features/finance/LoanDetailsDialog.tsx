import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Payment, Loan } from '../../types/finance'
import { formatDate, formatMoney } from '../../lib/format'
import { getLoanOutstandingPaise } from '../../domain/loans'

interface PaymentPage {
  items: Payment[]
  nextCursor?: string
}

export function LoanDetailsDialog({
  loan,
  customerName,
  customerPhone,
  today,
  canCollect,
  onLoadPayments,
  onCollect,
  onClose,
}: {
  loan: Loan
  customerName: string
  customerPhone: string
  today: string
  canCollect: boolean
  onLoadPayments: (loanId: string, cursor?: string) => Promise<PaymentPage>
  onCollect: (loanId: string) => void
  onClose: () => void
}) {
  const [history, setHistory] = useState<(string | undefined)[]>([undefined])
  const [payments, setPayments] = useState<Payment[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const cursor = history[history.length - 1]

  useEffect(() => {
    let active = true
    void onLoadPayments(loan.id, cursor).then((page) => {
      if (!active) return
      setPayments(page.items)
      setNextCursor(page.nextCursor)
    }).catch((cause: unknown) => {
      if (!active) return
      setError(cause instanceof Error ? cause.message : 'Transaction history could not be loaded.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [cursor, loan.id, onLoadPayments])

  const schedule = loan.schedule?.kind === 'FIXED'
    ? loan.schedule.installments.find((installment) => installment.dueDate >= today)
    : undefined

  function previousPage() {
    if (history.length <= 1 || loading) return
    setLoading(true)
    setError('')
    setHistory((current) => current.slice(0, -1))
  }

  function nextPage() {
    if (!nextCursor || loading) return
    setLoading(true)
    setError('')
    setHistory((current) => [...current, nextCursor])
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="dialog loan-details-dialog" role="dialog" aria-modal="true" aria-labelledby="loan-details-title">
        <div className="dialog-header">
          <div><span className="eyebrow">LOAN ACCOUNT · {loan.id}</span><h2 id="loan-details-title">{customerName}</h2></div>
          <button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="loan-detail-summary">
          <div><span>Balance due</span><strong>{formatMoney(getLoanOutstandingPaise(loan, today))}</strong></div>
          <div><span>Amount collected</span><strong>{formatMoney(loan.collectedPaise)}</strong></div>
          <div><span>Loan amount</span><strong>{formatMoney(loan.principalPaise)}</strong></div>
        </div>
        <dl className="loan-detail-facts">
          <div><dt>Customer mobile</dt><dd>{customerPhone || '—'}</dd></div>
          <div><dt>Loan type</dt><dd>{loan.type}</dd></div>
          <div><dt>Disbursed on</dt><dd>{formatDate(loan.disbursedOn)}</dd></div>
          <div><dt>Account status</dt><dd>{loan.status}</dd></div>
          {loan.schedule?.kind === 'MONTHLY' && <div><dt>First scheduled date</dt><dd>{formatDate(loan.schedule.firstDueDate)}</dd></div>}
          {schedule && <div><dt>Next scheduled installment</dt><dd>{formatDate(schedule.dueDate)} · {formatMoney(schedule.expectedAmountPaise)}</dd></div>}
        </dl>
        <section className="loan-transactions">
          <div className="panel-heading"><div><h3>Transactions</h3><p>Payment and reversal history for this loan.</p></div></div>
          {loading ? <p className="page-subtitle" role="status">Loading transactions…</p>
            : error ? <div className="form-error" role="alert">{error}</div>
              : payments.length === 0 ? <div className="empty-state">No transactions have been recorded for this loan.</div>
                : <div className="admin-table-wrap"><table><thead><tr><th>Transaction</th><th>Date</th><th>Method</th><th>Type</th><th>Amount</th></tr></thead><tbody>
                  {payments.map((payment) => <tr key={payment.id}><td>{payment.id}</td><td>{formatDate(payment.receivedOn)}</td><td>{payment.method}</td><td>{payment.entryType === 'REVERSAL' ? 'Reversal' : 'Payment'}</td><td>{formatMoney(payment.amountPaise)}</td></tr>)}
                </tbody></table></div>}
          <div className="list-footer"><span>{payments.length} transactions on this page</span><div>
            <button disabled={history.length <= 1 || loading} onClick={previousPage}>Previous</button>
            <button disabled={!nextCursor || loading} onClick={nextPage}>Next</button>
          </div></div>
        </section>
        <div className="dialog-actions">
          <button className="button button-quiet" onClick={onClose}>Close</button>
          {canCollect && loan.status === 'Active' && <button className="button button-primary" onClick={() => onCollect(loan.id)}>Record collection</button>}
        </div>
      </section>
    </div>
  )
}
