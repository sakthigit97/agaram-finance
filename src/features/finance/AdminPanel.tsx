import { useState, type FormEvent } from 'react'
import { RefreshCw, UserPlus } from 'lucide-react'
import type { AuditRecord, BusinessSettings, CustomFieldDefinition, StaffRecord } from '../../lib/api'

const emptySettings: BusinessSettings = {
  name: 'Agaram Finance',
  timeZone: 'Asia/Kolkata',
  dailyDurationDays: 90,
  weeklyInstallments: 10,
  version: 1,
}

export function AdminPanel({
  settings,
  customerFields,
  loanFields,
  staffFields,
  staff,
  audit,
  onRefresh,
  onSaveSettings,
  onSaveTemplate,
  onCreateStaff,
  onResetPassword,
}: {
  settings?: BusinessSettings | null
  customerFields: CustomFieldDefinition[]
  loanFields: CustomFieldDefinition[]
  staffFields: CustomFieldDefinition[]
  staff: StaffRecord[]
  audit: AuditRecord[]
  onRefresh?: () => Promise<void>
  onSaveSettings?: (settings: Partial<Omit<BusinessSettings, 'version'>>) => Promise<void>
  onSaveTemplate?: (entityType: 'CUSTOMER' | 'LOAN' | 'STAFF', fields: CustomFieldDefinition[]) => Promise<void>
  onCreateStaff?: (staff: { name: string; phone: string; customFields?: Record<string, string | number | boolean> }) => Promise<string>
  onResetPassword?: (userId: string) => Promise<string>
}) {
  const [currentSettings, setCurrentSettings] = useState(settings ?? emptySettings)
  const [customerDefinition, setCustomerDefinition] = useState(customerFields)
  const [loanDefinition, setLoanDefinition] = useState(loanFields)
  const [staffDefinition, setStaffDefinition] = useState(staffFields)
  const [staffName, setStaffName] = useState('')
  const [staffPhone, setStaffPhone] = useState('')
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [resetCredential, setResetCredential] = useState<{ userId: string; password: string } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(operation: () => Promise<void>, success: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
      setNotice(success)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void run(async () => {
      await onSaveSettings?.({
        name: currentSettings.name,
        timeZone: currentSettings.timeZone,
        dailyDurationDays: Number(currentSettings.dailyDurationDays),
        weeklyInstallments: Number(currentSettings.weeklyInstallments),
      })
    }, 'Business settings saved.')
  }

  function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void run(async () => {
      if (!onCreateStaff) return
      const data = new FormData(event.currentTarget)
      setTemporaryPassword(await onCreateStaff({ name: staffName.trim(), phone: staffPhone.trim(), customFields: collectFields(data, staffDefinition) }))
      setStaffName('')
      setStaffPhone('')
    }, 'Staff account created. Save the temporary password securely.')
  }

  function saveTemplate(entityType: 'CUSTOMER' | 'LOAN' | 'STAFF', fields: CustomFieldDefinition[]) {
    void run(async () => { await onSaveTemplate?.(entityType, fields) }, `${entityType.toLowerCase()} fields saved.`)
  }

  function changeField(
    entityType: 'CUSTOMER' | 'LOAN' | 'STAFF',
    index: number,
    key: keyof CustomFieldDefinition,
    value: string | boolean,
  ) {
    const update = entityType === 'CUSTOMER' ? setCustomerDefinition : entityType === 'LOAN' ? setLoanDefinition : setStaffDefinition
    update((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, [key]: value } : field))
  }

  function addField(entityType: 'CUSTOMER' | 'LOAN' | 'STAFF') {
    const update = entityType === 'CUSTOMER' ? setCustomerDefinition : entityType === 'LOAN' ? setLoanDefinition : setStaffDefinition
    update((current) => [...current, {
      key: '',
      label: '',
      type: 'text',
      required: false,
    }])
  }

  function removeField(entityType: 'CUSTOMER' | 'LOAN' | 'STAFF', index: number) {
    const update = entityType === 'CUSTOMER' ? setCustomerDefinition : entityType === 'LOAN' ? setLoanDefinition : setStaffDefinition
    update((current) => current.filter((_, fieldIndex) => fieldIndex !== index))
  }

  return (
    <section className="admin-panel">
      <div className="admin-heading"><div><p className="eyebrow">ADMINISTRATION</p><h2>Business settings</h2><p>Manage business rules, account access, and audit history.</p></div><button className="select-button" disabled={busy} onClick={() => void run(async () => { await onRefresh?.() }, 'Agent and audit records refreshed.')}><RefreshCw size={14} /> Refresh</button></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && <div className="admin-notice" role="status">{notice}</div>}
      {temporaryPassword && <div className="credential-result"><strong>One-time agent password</strong><output>{temporaryPassword}</output><button className="button button-quiet" onClick={() => setTemporaryPassword('')}>I saved it securely</button></div>}
      {resetCredential && <div className="credential-result"><strong>One-time password for {staff.find((member) => member.userId === resetCredential.userId)?.name ?? 'agent'}</strong><output>{resetCredential.password}</output><button className="button button-quiet" onClick={() => setResetCredential(null)}>I saved it securely</button></div>}
      <div className="admin-grid">
        <form className="admin-card" onSubmit={submitSettings}>
          <h3>Business settings</h3>
          <label className="form-field">Business name<input value={currentSettings.name} onChange={(event) => setCurrentSettings({ ...currentSettings, name: event.target.value })} required maxLength={100} /></label>
          <label className="form-field">Business time zone<input value={currentSettings.timeZone} onChange={(event) => setCurrentSettings({ ...currentSettings, timeZone: event.target.value })} required placeholder="Asia/Kolkata" /></label>
          <label className="form-field">Daily schedule duration<input type="number" min={1} max={365} value={currentSettings.dailyDurationDays} onChange={(event) => setCurrentSettings({ ...currentSettings, dailyDurationDays: Number(event.target.value) })} required /></label>
          <label className="form-field">Weekly installments<input type="number" min={1} max={52} value={currentSettings.weeklyInstallments} onChange={(event) => setCurrentSettings({ ...currentSettings, weeklyInstallments: Number(event.target.value) })} required /></label>
          <button className="button button-primary" disabled={busy}>Save settings</button>
        </form>
        <form className="admin-card" onSubmit={createStaff}>
          <h3><UserPlus size={16} /> Add agent</h3>
          <label className="form-field">Full name<input value={staffName} onChange={(event) => setStaffName(event.target.value)} required minLength={2} maxLength={100} /></label>
          <label className="form-field">Mobile number<input value={staffPhone} onChange={(event) => setStaffPhone(event.target.value)} required minLength={10} maxLength={10} pattern="[6-9][0-9]{9}" placeholder="10-digit mobile number" inputMode="numeric" /></label>
          {staffDefinition.map((field) => field.type === 'boolean'
            ? <label className="custom-checkbox" key={field.key}><input name={`custom:${field.key}`} type="checkbox" value="true" />{field.label}{field.required && ' *'}</label>
            : <label className="form-field" key={field.key}>{field.label}{field.required && ' *'}<input name={`custom:${field.key}`} type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'} required={field.required} step={field.type === 'number' ? 'any' : undefined} /></label>)}
          <p className="form-hint">A temporary password is generated once and must be changed on first sign-in.</p>
          <button className="button button-primary" disabled={busy}>Create agent account</button>
        </form>
      </div>
      <TemplateEditor entityType="CUSTOMER" fields={customerDefinition} busy={busy} onChange={changeField} onAdd={addField} onRemove={removeField} onSave={saveTemplate} />
      <TemplateEditor entityType="LOAN" fields={loanDefinition} busy={busy} onChange={changeField} onAdd={addField} onRemove={removeField} onSave={saveTemplate} />
      <TemplateEditor entityType="STAFF" fields={staffDefinition} busy={busy} onChange={changeField} onAdd={addField} onRemove={removeField} onSave={saveTemplate} />
      <section className="admin-card">
        <h3>Agent accounts</h3>
        {staff.length === 0 ? <p className="page-subtitle">No agent accounts are available.</p> : (
          <div className="admin-table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Status</th><th>Created</th><th>Reset password</th></tr></thead><tbody>
            {staff.map((member) => <tr key={member.staffId}><td>{member.name}</td><td>{member.phone}</td><td>{member.status}</td><td>{formatStaffDate(member.createdAt)}</td><td><button className="text-action" disabled={busy || !onResetPassword} onClick={() => void run(async () => { if (!onResetPassword) return; const password = await onResetPassword(member.userId); setResetCredential({ userId: member.userId, password }) }, `Temporary password generated for ${member.name}.`)}>Reset access</button></td></tr>)}
          </tbody></table></div>
        )}
      </section>
      <section className="admin-card">
        <h3>Recent audit events</h3>
        {audit.length === 0 ? <p className="page-subtitle">No audit events are loaded. Select Refresh to fetch the latest events.</p> : (
          <div className="admin-table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>Changes</th><th>Actor</th><th>Request</th></tr></thead><tbody>
            {audit.map((event) => <tr key={`${event.requestId}-${event.occurredAt}-${event.action}`}><td>{formatStaffDate(event.occurredAt)}</td><td>{event.action}</td><td>{event.entityId}</td><td>{formatAuditChanges(event.metadata)}</td><td>{event.actorUserId}</td><td>{event.requestId}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </section>
  )
}

function formatAuditChanges(metadata: AuditRecord['metadata']) {
  const before = metadata.before
  const after = metadata.after
  if (typeof before !== 'string' || typeof after !== 'string') return '—'
  try {
    const previous = JSON.parse(before) as Record<string, unknown>
    const current = JSON.parse(after) as Record<string, unknown>
    return Object.keys(current)
      .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(current[key]))
      .map((key) => `${key}: ${String(previous[key] ?? '-')} -> ${String(current[key] ?? '-')}`)
      .join('; ') || 'No field changes'
  } catch {
    return 'Change details unavailable'
  }
}

function TemplateEditor({
  entityType,
  fields,
  busy,
  onChange,
  onAdd,
  onRemove,
  onSave,
}: {
  entityType: 'CUSTOMER' | 'LOAN' | 'STAFF'
  fields: CustomFieldDefinition[]
  busy: boolean
  onChange: (entityType: 'CUSTOMER' | 'LOAN' | 'STAFF', index: number, key: keyof CustomFieldDefinition, value: string | boolean) => void
  onAdd: (entityType: 'CUSTOMER' | 'LOAN' | 'STAFF') => void
  onRemove: (entityType: 'CUSTOMER' | 'LOAN' | 'STAFF', index: number) => void
  onSave: (entityType: 'CUSTOMER' | 'LOAN' | 'STAFF', fields: CustomFieldDefinition[]) => void
}) {
  const entity = entityType.toLowerCase()
  return (
    <section className="admin-card">
      <div className="admin-section-heading"><div><h3>{entity} custom fields</h3><p>Field keys must be unique stable identifiers; retired fields keep historical values.</p></div><button type="button" className="select-button" onClick={() => onAdd(entityType)}>Add field</button></div>
      {fields.map((field, index) => <div className="template-row" key={`${entityType}-${index}`}>
        <label className="form-field">Key<input value={field.key} onChange={(event) => onChange(entityType, index, 'key', event.target.value)} placeholder="customerCode" /></label>
        <label className="form-field">Label<input value={field.label} onChange={(event) => onChange(entityType, index, 'label', event.target.value)} placeholder="Customer code" /></label>
        <label className="form-field">Type<select value={field.type} onChange={(event) => onChange(entityType, index, 'type', event.target.value)}><option value="text">Text</option><option value="number">Number</option><option value="boolean">Yes / no</option><option value="date">Date</option></select></label>
        <label className="custom-checkbox"><input type="checkbox" checked={field.required} onChange={(event) => onChange(entityType, index, 'required', event.target.checked)} />Required</label>
        <button type="button" className="text-action danger-action" onClick={() => onRemove(entityType, index)}>Remove</button>
      </div>)}
      {fields.length === 0 && <p className="page-subtitle">No additional fields are configured.</p>}
      <button className="button button-secondary" disabled={busy} onClick={() => onSave(entityType, fields)}>Save {entity} fields</button>
    </section>
  )
}

function formatStaffDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function collectFields(data: FormData, fields: CustomFieldDefinition[]) {
  const values: Record<string, string | number | boolean> = {}
  for (const field of fields) {
    const raw = data.get(`custom:${field.key}`)
    if (field.type === 'boolean') values[field.key] = raw === 'true'
    else if (raw !== null && raw !== '') values[field.key] = field.type === 'number' ? Number(raw) : String(raw)
  }
  return values
}
