import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type { CustomFieldDefinition } from '../../lib/api'
import type { Customer } from '../../types/finance'

export function CustomerEditDialog({
  customer,
  definitions,
  onClose,
  onSave,
}: {
  customer: Customer
  definitions: CustomFieldDefinition[]
  onClose: () => void
  onSave: (customerId: string, input: Record<string, unknown>) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const data = new FormData(event.currentTarget)
    const customFields: Record<string, string | number | boolean | null> = { ...(customer.customFields ?? {}) }
    for (const field of definitions) {
      const raw = data.get(`custom:${field.key}`)
      if (field.type === 'boolean') customFields[field.key] = raw === 'true'
      else if (raw !== null && raw !== '') customFields[field.key] = field.type === 'number' ? Number(raw) : String(raw)
      else customFields[field.key] = null
    }
    try {
      const email = String(data.get('email') ?? '').trim()
      await onSave(customer.id, {
        name: String(data.get('name') ?? ''),
        phone: String(data.get('phone') ?? ''),
        area: String(data.get('area') ?? ''),
        address: String(data.get('address') ?? ''),
        notes: String(data.get('notes') ?? ''),
        ...(email ? { email } : {}),
        customFields,
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Customer could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose() }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="customer-edit-title">
        <div className="dialog-header"><div><span className="eyebrow">CUSTOMER PROFILE</span><h2 id="customer-edit-title">Edit {customer.name}</h2></div><button className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submit}>
          <label className="form-field">Full name<input name="name" defaultValue={customer.name} required minLength={2} maxLength={100} /></label>
          <label className="form-field">Mobile number<input name="phone" type="tel" inputMode="numeric" pattern="[6-9][0-9]{9}" minLength={10} maxLength={10} defaultValue={customer.phone} required /></label>
          <label className="form-field">Area or locality<input name="area" defaultValue={customer.area} required minLength={2} maxLength={100} /></label>
          <label className="form-field">Address<input name="address" defaultValue={customer.address ?? ''} maxLength={500} /></label>
          <label className="form-field">Email<input name="email" type="email" defaultValue={customer.email ?? ''} maxLength={254} /></label>
          <label className="form-field">Notes<textarea name="notes" defaultValue={customer.notes ?? ''} rows={2} maxLength={1000} /></label>
          {definitions.map((field) => {
            const value = customer.customFields?.[field.key]
            if (field.type === 'boolean') return <label className="custom-checkbox" key={field.key}><input name={`custom:${field.key}`} type="checkbox" value="true" defaultChecked={value === true} />{field.label}</label>
            return <label className="form-field" key={field.key}>{field.label}<input name={`custom:${field.key}`} type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'} step={field.type === 'number' ? 'any' : undefined} defaultValue={value === undefined ? '' : String(value)} required={field.required} /></label>
          })}
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
        </form>
      </section>
    </div>
  )
}
