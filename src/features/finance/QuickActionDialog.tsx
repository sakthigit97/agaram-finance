import { z } from 'zod'
import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { getBusinessDate, parseRupeesToPaise } from '../../lib/format'
import type { CustomFieldDefinition } from '../../lib/api'
import type { Customer, FinanceAction, Loan } from '../../types/finance'

const customerSchema = z.object({
  name: z.string().trim().min(2, 'Enter the customer’s full name.').max(100),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number without country code.'),
  area: z.string().trim().min(2, 'Enter an area or locality.').max(100),
  address: z.string().trim().max(500).optional(),
  email: z.union([z.literal(''), z.string().email().max(254)]).optional(),
  notes: z.string().trim().max(1000).optional(),
})

const staffSchema = z.object({
  name: z.string().trim().min(2, 'Enter the agent’s full name.').max(100),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number without country code.'),
})

const loanSchema = z.object({
  customerId: z.string().min(1, 'Select a customer.'),
  type: z.enum(['Daily', 'Weekly', 'Monthly']),
  principal: z.string().min(1, 'Enter the principal amount.'),
  interest: z.string(),
  fee: z.string(),
  disbursedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Select a valid disbursement date.'),
})

const paymentSchema = z.object({
  loanId: z.string().min(1, 'Select a loan.'),
  amount: z.string().min(1, 'Enter the payment amount.'),
  method: z.enum(['Cash', 'UPI', 'Bank transfer', 'Cheque']),
})

export function QuickActionDialog({
  action,
  customers,
  loans,
  customerFields,
  loanFields,
  staffFields,
  onClose,
  onCreateCustomer,
  onCreateStaff,
  onCreateLoan,
  onRecordPayment,
  initialLoanId,
}: {
  action: FinanceAction
  customers: Customer[]
  loans: Loan[]
  customerFields: CustomFieldDefinition[]
  loanFields: CustomFieldDefinition[]
  staffFields: CustomFieldDefinition[]
  onClose: () => void
  onCreateCustomer: (customer: Record<string, unknown>) => Promise<string>
  onCreateStaff: (staff: { name: string; phone: string; customFields?: Record<string, string | number | boolean> }) => Promise<string>
  onCreateLoan: (loan: Record<string, unknown>, idempotencyKey: string) => Promise<void>
  onRecordPayment: (loanId: string, payment: Record<string, unknown>, idempotencyKey: string) => Promise<void>
  initialLoanId?: string
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loanType, setLoanType] = useState<'Daily' | 'Weekly' | 'Monthly'>('Daily')
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const title = action === 'customer' ? 'Add a customer'
    : action === 'staff' ? 'Add an agent'
      : action === 'loan' ? 'Create a loan' : 'Record a payment'
  const customFields = action === 'customer' ? customerFields : action === 'loan' ? loanFields : staffFields

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    const data = new FormData(event.currentTarget)
    try {
      if (action === 'customer') {
        const parsed = customerSchema.safeParse({
          name: data.get('name'),
          phone: data.get('phone'),
          area: data.get('area'),
          address: data.get('address') || undefined,
          email: data.get('email') || undefined,
          notes: data.get('notes') || undefined,
        })
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the customer details.')
        const created = await onCreateCustomer({
          ...parsed.data,
          ...(parsed.data.email ? { email: parsed.data.email } : {}),
          customFields: collectCustomFields(data, customFields),
        })
        setTemporaryPassword(created)
        return
      }

      if (action === 'staff') {
        const parsed = staffSchema.safeParse({ name: data.get('name'), phone: data.get('phone') })
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the agent details.')
        setTemporaryPassword(await onCreateStaff({ ...parsed.data, customFields: collectCustomFields(data, customFields) }))
        return
      }

      if (action === 'loan') {
        const parsed = loanSchema.safeParse({
          customerId: data.get('customerId'),
          type: data.get('type'),
          principal: data.get('principal'),
          interest: data.get('interest') || '0',
          fee: data.get('fee') || '0',
          disbursedOn: data.get('disbursedOn') || getBusinessDate(),
        })
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the loan details.')
        const principalPaise = parseRupeesToPaise(parsed.data.principal)
        const interestPaise = parseRupeesToPaise(parsed.data.interest)
        const feePaise = parseRupeesToPaise(parsed.data.fee)
        if (principalPaise === null || interestPaise === null || feePaise === null || principalPaise <= 0) {
          throw new Error('Enter valid amounts with up to two decimal places.')
        }
        if (parsed.data.type === 'Monthly' && (interestPaise <= 0 || feePaise > 0)) {
          throw new Error('Monthly loans require monthly interest and do not use an upfront book fee.')
        }
        if (parsed.data.type !== 'Monthly' && principalPaise < interestPaise + feePaise) {
          throw new Error('Upfront interest and fee cannot exceed the loan amount.')
        }
        await onCreateLoan({
          customerId: parsed.data.customerId,
          type: parsed.data.type.toUpperCase(),
          principalPaise,
          upfrontInterestPaise: parsed.data.type === 'Monthly' ? 0 : interestPaise,
          bookFeePaise: parsed.data.type === 'Monthly' ? 0 : feePaise,
          monthlyInterestPaise: parsed.data.type === 'Monthly' ? interestPaise : 0,
          disbursedOn: parsed.data.disbursedOn,
          customFields: collectCustomFields(data, customFields),
        }, idempotencyKey)
        onClose()
        return
      }

      const parsed = paymentSchema.safeParse({
        loanId: data.get('loanId'),
        amount: data.get('amount'),
        method: data.get('method'),
      })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the payment details.')
      const amountPaise = parseRupeesToPaise(parsed.data.amount)
      if (amountPaise === null || amountPaise <= 0) throw new Error('Enter a valid payment amount.')
      await onRecordPayment(parsed.data.loanId, {
        amountPaise,
        method: parsed.data.method === 'Bank transfer' ? 'BANK_TRANSFER' : parsed.data.method.toUpperCase(),
        receivedOn: data.get('receivedOn') || getBusinessDate(),
      }, idempotencyKey)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  function resetIdempotencyKey() {
    setIdempotencyKey(crypto.randomUUID())
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-header"><div><span className="eyebrow">AGARAM FINANCE</span><h2 id="dialog-title">{temporaryPassword ? `${action === 'staff' ? 'Agent' : 'Customer'} account created` : title}</h2></div><button className="icon-button" aria-label="Close" onClick={onClose} disabled={busy}><X size={18} /></button></div>
        {temporaryPassword ? (
          <div className="credential-result">
            <p>Share this temporary password securely. It is shown only once and must be changed at first sign-in.</p>
            <label className="form-field">Temporary password<output>{temporaryPassword}</output></label>
            <button className="button button-primary" onClick={onClose}>I have saved it securely</button>
          </div>
        ) : (
          <form onSubmit={submit} onChange={resetIdempotencyKey}>
            {action === 'staff' && <>
              <label className="form-field">Agent full name<input name="name" autoFocus required minLength={2} maxLength={100} /></label>
              <label className="form-field">Mobile number<input name="phone" required maxLength={10} pattern="[6-9][0-9]{9}" placeholder="10-digit mobile number" inputMode="numeric" /></label>
              <p className="form-hint">A unique temporary password is created and must be changed at first sign-in.</p>
            </>}
            {action === 'customer' && <>
              <label className="form-field">Full name<input name="name" autoFocus required maxLength={100} placeholder="e.g. Meena Krishnan" /></label>
              <label className="form-field">Mobile number<input name="phone" required maxLength={10} pattern="[6-9][0-9]{9}" placeholder="10-digit mobile number" inputMode="numeric" /></label>
              <label className="form-field">Area or locality<input name="area" required maxLength={100} placeholder="e.g. Anna Nagar" /></label>
              <label className="form-field">Address (optional)<input name="address" maxLength={500} /></label>
              <label className="form-field">Email (optional)<input name="email" type="email" maxLength={254} /></label>
              <label className="form-field">Notes (optional)<textarea name="notes" maxLength={1000} rows={2} /></label>
            </>}
            {action === 'loan' && <>
              <label className="form-field">Customer<select name="customerId" defaultValue="" required><option value="" disabled>Select a customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.phone}</option>)}</select></label>
              <label className="form-field">Loan type<select name="type" value={loanType} onChange={(event) => setLoanType(event.target.value as 'Daily' | 'Weekly' | 'Monthly')}><option>Daily</option><option>Weekly</option><option>Monthly</option></select></label>
              <label className="form-field">Principal amount (₹)<input name="principal" type="number" min="0.01" step="0.01" required placeholder="10000" inputMode="decimal" /></label>
                  <div className="form-row"><label className="form-field">{loanType === 'Monthly' ? 'Monthly interest (₹)' : 'Upfront interest (₹)'}<input name="interest" type="number" min="0" step="0.01" placeholder={loanType === 'Monthly' ? '3000' : '1000'} inputMode="decimal" /></label><label className="form-field">Book fee (₹)<input name="fee" type="number" min="0" step="0.01" placeholder="0" inputMode="decimal" disabled={loanType === 'Monthly'} /></label></div>
                  <label className="form-field">Disbursement date<input type="date" name="disbursedOn" defaultValue={getBusinessDate()} max={getBusinessDate()} required /></label>
              <p className="form-hint">{loanType === 'Monthly' ? 'A fixed interest charge is added per complete monthly cycle. Payments are applied to interest first.' : 'The repayment schedule is calculated from the selected loan type.'}</p>
            </>}
            {action === 'payment' && <>
              <label className="form-field">Loan<select name="loanId" defaultValue={initialLoanId ?? ''} required><option value="" disabled>Select an active loan</option>{loans.filter((loan) => loan.status === 'Active').map((loan) => <option key={loan.id} value={loan.id}>{loan.id} · {customers.find((customer) => customer.id === loan.customerId)?.name ?? 'Customer'}</option>)}</select></label>
              <label className="form-field">Amount received (₹)<input name="amount" type="number" min="0.01" step="0.01" autoFocus required placeholder="500" inputMode="decimal" /></label>
              <label className="form-field">Payment method<select name="method" defaultValue="Cash"><option>Cash</option><option>UPI</option><option>Bank transfer</option><option>Cheque</option></select></label>
              <label className="form-field">Payment date<input type="date" name="receivedOn" defaultValue={getBusinessDate()} max={getBusinessDate()} required /></label>
              <p className="form-hint">The remaining balance is checked before the payment is recorded.</p>
            </>}
            {customFields.length > 0 && (action === 'customer' || action === 'loan' || action === 'staff') && (
              <fieldset className="custom-fields">
                <legend>Additional details</legend>
                {customFields.map((field) => <CustomFieldInput key={field.key} field={field} />)}
              </fieldset>
            )}
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Saving securely…' : title}</button></div>
          </form>
        )}
      </section>
    </div>
  )
}

function CustomFieldInput({ field }: { field: CustomFieldDefinition }) {
  const name = `custom:${field.key}`
  if (field.type === 'boolean') {
    return <label className="custom-checkbox"><input name={name} type="checkbox" value="true" />{field.label}{field.required ? ' *' : ''}</label>
  }
  return (
    <label className="form-field">{field.label}{field.required && ' *'}
      <input
        name={name}
        type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
        required={field.required}
        step={field.type === 'number' ? 'any' : undefined}
      />
    </label>
  )
}

function collectCustomFields(data: FormData, definitions: CustomFieldDefinition[]) {
  const values: Record<string, string | number | boolean> = {}
  for (const field of definitions) {
    const raw = data.get(`custom:${field.key}`)
    if (field.type === 'boolean') {
      values[field.key] = raw === 'true'
    } else if (raw !== null && raw !== '') {
      if (field.type === 'number') {
        const value = Number(raw)
        if (!Number.isFinite(value)) throw new Error(`${field.label} must be a valid number.`)
        values[field.key] = value
      } else {
        values[field.key] = String(raw)
      }
    }
  }
  return values
}
