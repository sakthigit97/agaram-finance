import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { parseRupeesToPaise } from '../../lib/format'
import type { Payment } from '../../types/finance'

export function TransactionEditDialog({
  payment,
  onClose,
  onSave,
}: {
  payment: Payment
  onClose: () => void
  onSave: (loanId: string, paymentId: string, input: Record<string, unknown>) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const amountPaise = parseRupeesToPaise(String(data.get('amount') ?? ''))
    if (amountPaise === null || amountPaise <= 0) {
      setError('Enter a valid amount with up to two decimal places.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const method = String(data.get('method'))
      await onSave(payment.loanId, payment.id, {
        amountPaise,
        method: method === 'Bank transfer' ? 'BANK_TRANSFER' : method.toUpperCase(),
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Transaction could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose() }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="transaction-edit-title">
        <div className="dialog-header"><div><span className="eyebrow">TRANSACTION · {payment.id}</span><h2 id="transaction-edit-title">Edit transaction</h2></div><button className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submit}>
          <label className="form-field">Amount received (₹)<input name="amount" type="number" min="0.01" step="0.01" defaultValue={(payment.amountPaise / 100).toFixed(2)} inputMode="decimal" required /></label>
          <label className="form-field">Payment method<select name="method" defaultValue={payment.method}><option>Cash</option><option>UPI</option><option>Bank transfer</option><option>Cheque</option></select></label>
          <p className="form-hint">Payment date and transaction ID are retained. Only the latest posted transaction can be edited so later allocations stay consistent.</p>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save transaction'}</button></div>
        </form>
      </section>
    </div>
  )
}
