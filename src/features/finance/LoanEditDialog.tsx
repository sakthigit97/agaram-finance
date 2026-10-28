import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type { CustomFieldDefinition } from '../../lib/api'
import { getBusinessDate, parseRupeesToPaise } from '../../lib/format'
import type { Loan } from '../../types/finance'

export function LoanEditDialog({
  loan,
  definitions,
  hasTransactions,
  onCheckTransactions,
  onClose,
  onSave,
}: {
  loan: Loan
  definitions: CustomFieldDefinition[]
  hasTransactions: boolean
  onCheckTransactions: (loanId: string) => Promise<boolean>
  onClose: () => void
  onSave: (loanId: string, input: Record<string, unknown>) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ledgerHasEntries, setLedgerHasEntries] = useState(hasTransactions)
  const [checkingTransactions, setCheckingTransactions] = useState(!hasTransactions)
  const [transactionCheckError, setTransactionCheckError] = useState('')
  const financialTermsLocked = hasTransactions || ledgerHasEntries || checkingTransactions || Boolean(transactionCheckError)

  useEffect(() => {
    if (hasTransactions) return
    let active = true
    void onCheckTransactions(loan.id).then((hasEntries) => {
      if (active) setLedgerHasEntries(hasEntries)
    }).catch((cause: unknown) => {
      if (active) setTransactionCheckError(cause instanceof Error ? cause.message : 'Loan history could not be verified.')
    }).finally(() => {
      if (active) setCheckingTransactions(false)
    })
    return () => { active = false }
  }, [hasTransactions, loan.id, onCheckTransactions])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    const customFields: Record<string, string | number | boolean | null> = { ...(loan.customFields ?? {}) }
    for (const field of definitions) {
      const value = data.get(`custom:${field.key}`)
      if (field.type === 'boolean') customFields[field.key] = value === 'true'
      else if (value === null || value === '') customFields[field.key] = null
      else if (field.type === 'number') customFields[field.key] = Number(value)
      else customFields[field.key] = String(value)
    }
    try {
      const input: Record<string, unknown> = { customFields }
      if (!financialTermsLocked) {
        const principalPaise = parseRupeesToPaise(String(data.get('principal') ?? ''))
        const interestPaise = parseRupeesToPaise(String(data.get('interest') ?? '0'))
        const feePaise = parseRupeesToPaise(String(data.get('fee') ?? '0'))
        if (principalPaise === null || principalPaise <= 0 || interestPaise === null || feePaise === null) {
          throw new Error('Enter valid amounts with up to two decimal places.')
        }
        const type = String(data.get('type'))
        Object.assign(input, {
          type: type.toUpperCase(),
          principalPaise,
          upfrontInterestPaise: type === 'Monthly' ? 0 : interestPaise,
          bookFeePaise: type === 'Monthly' ? 0 : feePaise,
          monthlyInterestPaise: type === 'Monthly' ? interestPaise : 0,
          disbursedOn: String(data.get('disbursedOn')),
        })
      }
      await onSave(loan.id, input)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Loan could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose() }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="loan-edit-title">
        <div className="dialog-header"><div><span className="eyebrow">LOAN RECORD · {loan.id}</span><h2 id="loan-edit-title">Edit loan</h2></div><button className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submit}>
          {financialTermsLocked
            ? <p className="form-hint">{checkingTransactions ? 'Checking loan history. Financial terms are locked until the check is complete.' : transactionCheckError ? 'Loan history could not be verified, so financial terms remain locked. Custom fields are still editable.' : 'Financial terms are locked after transactions are posted. Custom fields remain editable; use transaction edit for a payment correction.'}</p>
            : <>
              <label className="form-field">Loan type<select name="type" defaultValue={loan.type}><option>Daily</option><option>Weekly</option><option>Monthly</option></select></label>
              <label className="form-field">Principal amount (₹)<input name="principal" defaultValue={(loan.principalPaise / 100).toFixed(2)} inputMode="decimal" required /></label>
              <div className="form-row"><label className="form-field">Interest (₹)<input name="interest" defaultValue={(loan.interestPaise / 100).toFixed(2)} inputMode="decimal" /></label><label className="form-field">Book fee (₹)<input name="fee" defaultValue={(loan.feePaise / 100).toFixed(2)} inputMode="decimal" /></label></div>
              <label className="form-field">Disbursement date<input type="date" name="disbursedOn" defaultValue={loan.disbursedOn} max={getBusinessDate()} required /></label>
            </>}
          {definitions.map((field) => {
            const value = loan.customFields?.[field.key]
            if (field.type === 'boolean') return <label className="custom-checkbox" key={field.key}><input name={`custom:${field.key}`} type="checkbox" value="true" defaultChecked={value === true} />{field.label}</label>
            return <label className="form-field" key={field.key}>{field.label}<input name={`custom:${field.key}`} type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'} defaultValue={value === undefined ? '' : String(value)} required={field.required} /></label>
          })}
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save loan'}</button></div>
        </form>
      </section>
    </div>
  )
}
