import { useMemo, useState, type FormEvent } from 'react'
import { KeyRound, Pencil, Plus, Search, UsersRound, X } from 'lucide-react'
import type { CustomFieldDefinition, StaffRecord } from '../../lib/api'

export function AgentsPage({
  staff,
  definitions,
  onCreate,
  onUpdate,
  onResetPassword,
}: {
  staff: StaffRecord[]
  definitions: CustomFieldDefinition[]
  onCreate: () => void
  onUpdate: (staffId: string, input: { name?: string; phone?: string; customFields?: Record<string, string | number | boolean | null> }) => Promise<void>
  onResetPassword: (userId: string) => Promise<string>
}) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<StaffRecord | null>(null)
  const [credential, setCredential] = useState<{ name: string; password: string } | null>(null)
  const [error, setError] = useState('')
  const [resettingId, setResettingId] = useState('')

  const visibleAgents = useMemo(() => {
    const filter = query.trim().toLowerCase()
    const digits = filter.replace(/\D/g, '')
    return staff.filter((member) => [member.staffId, member.name, member.phone, member.status].some((value) =>
      value.toLowerCase().includes(filter)
      || (digits.length > 0 && value.replace(/\D/g, '').includes(digits)),
    ))
  }, [query, staff])

  async function resetAccess(agent: StaffRecord) {
    setError('')
    setCredential(null)
    setResettingId(agent.staffId)
    try {
      setCredential({ name: agent.name, password: await onResetPassword(agent.userId) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Agent access could not be reset.')
    } finally {
      setResettingId('')
    }
  }

  return (
    <div className="page-wrap">
      <header className="topbar">
        <div className="breadcrumb"><span>Workspace</span><span className="crumb-separator">/</span><strong>Agents</strong></div>
      </header>
      <section className="welcome-row section-welcome">
        <div><div className="eyebrow">ACCOUNT MANAGEMENT</div><h1>Agents</h1><p className="page-subtitle">View and manage agent contact details and account access.</p></div>
        <button className="button button-primary" onClick={onCreate}><Plus size={16} /> Add agent</button>
      </section>
      <section className="panel list-panel">
        <div className="list-toolbar">
          <div><h2>Agent accounts</h2><p>{visibleAgents.length} of {staff.length} agents</p></div>
          <label className="search-input"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by agent ID, name, or mobile" /></label>
        </div>
        {error && <div className="form-error agent-page-error" role="alert">{error}</div>}
        {credential && <div className="credential-result"><strong>One-time password for {credential.name}</strong><output>{credential.password}</output><p>Share it securely. The agent must change it at first sign-in.</p><button className="button button-quiet" onClick={() => setCredential(null)}>I saved it securely</button></div>}
        <div className="admin-table-wrap">
          <table>
            <thead><tr><th>Agent</th><th>Mobile number</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>{visibleAgents.map((agent) => (
              <tr key={agent.staffId}>
                <td><div className="customer-cell"><span className="table-avatar">{initials(agent.name)}</span><span><strong>{agent.name}</strong><small>{agent.staffId}</small></span></div></td>
                <td>{agent.phone}</td>
                <td><span className={`status-pill ${agent.status === 'ACTIVE' ? 'status-complete' : 'status-reversed'}`}><span />{agent.status === 'ACTIVE' ? 'Active' : 'Disabled'}</span></td>
                <td>{formatStaffDate(agent.createdAt)}</td>
                <td className="agent-actions">
                  <button className="text-action" onClick={() => setEditing(agent)}><Pencil size={13} /> Edit</button>
                  <button className="text-action" disabled={resettingId === agent.staffId} onClick={() => void resetAccess(agent)}>
                    <KeyRound size={13} />{resettingId === agent.staffId ? 'Resetting…' : 'Reset access'}
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {visibleAgents.length === 0 && <div className="empty-state">{query ? 'No agents match this filter.' : <><UsersRound size={18} /> No agents have been added yet.</>}</div>}
        </div>
      </section>
      {editing && <AgentEditDialog agent={editing} definitions={definitions} onClose={() => setEditing(null)} onSave={onUpdate} />}
    </div>
  )
}

function AgentEditDialog({
  agent,
  definitions,
  onClose,
  onSave,
}: {
  agent: StaffRecord
  definitions: CustomFieldDefinition[]
  onClose: () => void
  onSave: (staffId: string, input: { name?: string; phone?: string; customFields?: Record<string, string | number | boolean | null> }) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const data = new FormData(event.currentTarget)
    try {
      const customFields: Record<string, string | number | boolean | null> = { ...(agent.customFields ?? {}) }
      for (const field of definitions) {
        const raw = data.get(`custom:${field.key}`)
        customFields[field.key] = field.type === 'boolean' ? raw === 'true' : raw === '' ? null : field.type === 'number' ? Number(raw) : String(raw)
      }
      await onSave(agent.staffId, {
        name: String(data.get('name') ?? '').trim(),
        phone: String(data.get('phone') ?? '').trim(),
        customFields,
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Agent details could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose() }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="agent-edit-title">
        <div className="dialog-header"><div><span className="eyebrow">AGENT PROFILE</span><h2 id="agent-edit-title">Edit {agent.name}</h2></div><button className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submit}>
          <label className="form-field">Full name<input name="name" defaultValue={agent.name} required minLength={2} maxLength={100} /></label>
          <label className="form-field">Mobile number<input name="phone" type="tel" inputMode="numeric" pattern="[6-9][0-9]{9}" minLength={10} maxLength={10} defaultValue={agent.phone} required /></label>
          {definitions.length > 0 && <fieldset className="custom-fields"><legend>Additional details</legend>{definitions.map((field) => {
            const value = agent.customFields?.[field.key]
            return field.type === 'boolean'
              ? <label className="custom-checkbox" key={field.key}><input name={`custom:${field.key}`} type="checkbox" value="true" defaultChecked={value === true} />{field.label}{field.required && ' *'}</label>
              : <label className="form-field" key={field.key}>{field.label}{field.required && ' *'}<input name={`custom:${field.key}`} type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'} defaultValue={value === undefined ? '' : String(value)} required={field.required} step={field.type === 'number' ? 'any' : undefined} /></label>
          })}</fieldset>}
          <p className="form-hint">The mobile number is also the agent’s login ID. It must be unique.</p>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
        </form>
      </section>
    </div>
  )
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase()
}

function formatStaffDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(value))
}
