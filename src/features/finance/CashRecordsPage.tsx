import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Plus, Search, X } from 'lucide-react'
import { formatDate, formatMoney, getBusinessDate, parseRupeesToPaise } from '../../lib/format'
import type { ExpenseRecord, InvestmentRecord, Page, StaffRecord } from '../../lib/api'

type CashRecord = ExpenseRecord | InvestmentRecord
type RecordKind = 'expenses' | 'investments'

export function CashRecordsPage({
  kind,
  staff,
  userId,
  userName,
  isAdmin,
  onLoad,
  onCreate,
  onUpdate,
}: {
  kind: RecordKind
  staff: StaffRecord[]
  userId: string
  userName: string
  isAdmin: boolean
  onLoad: (from: string, to: string, cursor?: string) => Promise<Page<CashRecord>>
  onCreate: (body: Record<string, unknown>) => Promise<CashRecord>
  onUpdate: (recordId: string, body: Record<string, unknown>) => Promise<CashRecord>
}) {
  const isExpense = kind === 'expenses'
  const today = getBusinessDate()
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const initialRange = useRef({ from, to })
  const [records, setRecords] = useState<CashRecord[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<CashRecord | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (start: string, end: string, cursor?: string) => {
    setLoading(true)
    setError('')
    try {
      const page = await onLoad(start, end, cursor)
      setRecords(page.items)
      setNextCursor(page.nextCursor)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${isExpense ? 'Expenses' : 'Investments'} could not be loaded.`)
    } finally {
      setLoading(false)
    }
  }, [isExpense, onLoad])

  useEffect(() => {
    void load(initialRange.current.from, initialRange.current.to)
  }, [load])

  const visibleRecords = useMemo(() => {
    const filter = query.trim().toLowerCase()
    if (!filter) return records
    return records.filter((record) => [
      record.recordId,
      record.date,
      String(record.amountPaise),
      'reason' in record ? record.reason : record.investorName,
      record.comments ?? '',
      'agentId' in record ? staff.find((member) => member.staffId === record.agentId)?.name ?? '' : '',
    ].some((field) => field.toLowerCase().includes(filter)))
  }, [query, records, staff])

  async function submitRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (from > to) {
      setError('The start date must be on or before the end date.')
      return
    }
    setCursors([undefined])
    await load(from, to)
  }

  async function changePage(cursor?: string) {
    if (cursor === undefined && cursors.length <= 1) return
    const nextCursors = cursor
      ? [...cursors, cursor]
      : cursors.slice(0, -1)
    const selectedCursor = cursor ?? nextCursors[nextCursors.length - 1]
    setCursors(nextCursors)
    await load(from, to, selectedCursor)
  }

  async function saveRecord(body: Record<string, unknown>, record?: CashRecord) {
    if (record) await onUpdate(record.recordId, body)
    else await onCreate(body)
    setEditing(null)
    setCreating(false)
    setCursors([undefined])
    await load(from, to)
  }

  const title = isExpense ? 'Expenses' : 'Investments'
  return (
    <div className="page-wrap">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="crumb-separator">/</span><strong>{title}</strong></div></header>
      <section className="welcome-row section-welcome">
        <div><div className="eyebrow">FINANCE RECORDS</div><h1>{title}</h1><p className="page-subtitle">{isExpense ? 'Track business expenses and the agent responsible.' : 'Track capital contributions by investor.'}</p></div>
        <button className="button button-primary" onClick={() => { setError(''); setCreating(true) }}><Plus size={16} /> Add {isExpense ? 'expense' : 'investment'}</button>
      </section>
      <section className="panel list-panel">
        <div className="list-toolbar">
          <div><h2>{isExpense ? 'Expense records' : 'Capital contributions'}</h2><p>{visibleRecords.length} records shown on this page{loading ? ' · Loading…' : ''}</p></div>
          <div className="table-controls">
            <form className="record-date-filter" onSubmit={(event) => void submitRange(event)}>
              <label>From<input type="date" value={from} max={to} required onChange={(event) => setFrom(event.target.value)} /></label>
              <label>To<input type="date" value={to} min={from} max={today} required onChange={(event) => setTo(event.target.value)} /></label>
              <button className="select-button" disabled={loading}>Apply</button>
            </form>
            <label className="search-input"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Filter ${isExpense ? 'expenses' : 'investments'} on this page`} /></label>
          </div>
        </div>
        {error && <div className="form-error records-page-error" role="alert">{error}</div>}
        <div className="table-scroll">
          {isExpense ? (
            <table><thead><tr><th>Date</th><th>Amount</th><th>Reason</th><th>Agent</th><th>Comments</th><th>Actions</th></tr></thead><tbody>
              {(visibleRecords as ExpenseRecord[]).map((record) => <tr key={record.recordId}>
                <td>{formatDate(record.date)}</td><td className="amount-cell">{formatMoney(record.amountPaise)}</td><td>{record.reason}</td>
                <td>{staff.find((member) => member.staffId === record.agentId)?.name ?? (record.agentId === userId ? userName : record.agentId ?? '—')}</td><td>{record.comments || '—'}</td>
                <td><button className="text-action" onClick={() => setEditing(record)}>Edit</button></td>
              </tr>)}
            </tbody></table>
          ) : (
            <table><thead><tr><th>Date</th><th>Amount</th><th>Investor</th><th>Comments</th><th>Actions</th></tr></thead><tbody>
              {(visibleRecords as InvestmentRecord[]).map((record) => <tr key={record.recordId}>
                <td>{formatDate(record.date)}</td><td className="amount-cell">{formatMoney(record.amountPaise)}</td><td>{record.investorName}</td><td>{record.comments || '—'}</td>
                <td><button className="text-action" onClick={() => setEditing(record)}>Edit</button></td>
              </tr>)}
            </tbody></table>
          )}
          {visibleRecords.length === 0 && <div className="empty-state">{query ? 'No records match this filter.' : loading ? 'Loading records…' : `No ${title.toLowerCase()} found in this date range.`}</div>}
        </div>
        <div className="list-footer"><span>Showing <strong>{visibleRecords.length}</strong> records · page {cursors.length}</span><div>
          <button onClick={() => void changePage()} disabled={cursors.length === 1 || loading}><ArrowLeft size={13} /> Previous</button>
          <span className="current-page">{cursors.length}</span>
          <button onClick={() => nextCursor && void changePage(nextCursor)} disabled={!nextCursor || loading}>Next <ArrowRight size={13} /></button>
        </div></div>
      </section>
      {(creating || editing) && <CashRecordDialog
        key={editing?.recordId ?? `${kind}-new`}
        kind={kind}
        record={editing}
        staff={staff}
        userName={userName}
        isAdmin={isAdmin}
        onClose={() => { setCreating(false); setEditing(null) }}
        onSave={(body) => saveRecord(body, editing ?? undefined)}
      />}
    </div>
  )
}

function CashRecordDialog({
  kind,
  record,
  staff,
  userName,
  isAdmin,
  onClose,
  onSave,
}: {
  kind: RecordKind
  record: CashRecord | null
  staff: StaffRecord[]
  userName: string
  isAdmin: boolean
  onClose: () => void
  onSave: (body: Record<string, unknown>) => Promise<void>
}) {
  const isExpense = kind === 'expenses'
  const expense = record && 'reason' in record ? record : undefined
  const investment = record && 'investorName' in record ? record : undefined
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const data = new FormData(event.currentTarget)
    const amountPaise = parseRupeesToPaise(String(data.get('amount') ?? ''))
    if (amountPaise === null || amountPaise <= 0) {
      setError('Enter an amount greater than zero with up to two decimal places.')
      setBusy(false)
      return
    }
    try {
      await onSave({
        date: String(data.get('date') ?? ''),
        amountPaise,
        ...(isExpense
          ? {
              reason: String(data.get('reason') ?? '').trim(),
              comments: String(data.get('comments') ?? '').trim(),
              ...(isAdmin ? { agentId: String(data.get('agentId') ?? '') || undefined } : {}),
            }
          : {
              investorName: String(data.get('investorName') ?? '').trim(),
              comments: String(data.get('comments') ?? '').trim(),
            }),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${isExpense ? 'Expense' : 'Investment'} could not be saved.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose() }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="cash-record-title">
        <div className="dialog-header"><div><span className="eyebrow">{isExpense ? 'BUSINESS COST' : 'INVESTOR CAPITAL'}</span><h2 id="cash-record-title">{record ? 'Edit' : 'Add'} {isExpense ? 'expense' : 'investment'}</h2></div><button className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={(event) => void submit(event)}>
          <label className="form-field">Date<input name="date" type="date" max={getBusinessDate()} defaultValue={record?.date ?? getBusinessDate()} required /></label>
          <label className="form-field">Amount (₹)<input name="amount" inputMode="decimal" defaultValue={record ? (record.amountPaise / 100).toFixed(2) : ''} placeholder="0.00" required /></label>
          {isExpense
            ? <>
                <label className="form-field">Reason<input name="reason" defaultValue={expense?.reason ?? ''} required minLength={2} maxLength={500} placeholder="What was this expense for?" /></label>
                <label className="form-field">Agent
                  {isAdmin
                    ? <select name="agentId" defaultValue={expense?.agentId ?? ''}><option value="">Not assigned</option>{staff.filter((member) => member.status === 'ACTIVE').map((member) => <option key={member.staffId} value={member.staffId}>{member.name}</option>)}</select>
                    : <input value={`${userName} (you)`} readOnly aria-readonly="true" />}
                </label>
              </>
            : <label className="form-field">Investor name<input name="investorName" defaultValue={investment?.investorName ?? ''} required minLength={2} maxLength={120} /></label>}
          <label className="form-field">Comments<textarea name="comments" defaultValue={record?.comments ?? ''} rows={2} maxLength={1000} /></label>
          {!record && isExpense && !isAdmin && <p className="form-hint">This expense will be assigned to your agent account.</p>}
          {!isExpense && <p className="form-hint">Investor contributions are tracked as capital, not as business earnings.</p>}
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save record'}</button></div>
        </form>
      </section>
    </div>
  )
}
