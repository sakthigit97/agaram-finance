import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { api, ApiError } from '../../lib/api'

export function ChangePasswordDialog({
  token,
  onClose,
}: {
  token: string
  onClose: () => void
}) {
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setError('')
    setNotice('')
    const data = new FormData(form)
    const currentPassword = String(data.get('currentPassword') ?? '')
    const newPassword = String(data.get('newPassword') ?? '')
    if (newPassword !== String(data.get('confirmPassword') ?? '')) {
      setError('The new passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await api.changePassword(token, currentPassword, newPassword)
      setNotice('Password changed. Keep the new password private and secure.')
      form.reset()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Password could not be changed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
        <div className="dialog-header"><div><span className="eyebrow">ACCOUNT SECURITY</span><h2 id="change-password-title">Change password</h2></div><button className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submit}>
          <label className="form-field">Current password<input name="currentPassword" type="password" autoComplete="current-password" required autoFocus /></label>
          <label className="form-field">New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={72} required /></label>
          <label className="form-field">Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={72} required /></label>
          <p className="form-hint">Use at least 12 characters and no more than 72 UTF-8 bytes. Passwords are not stored in this browser or included in application logs.</p>
          {error && <div className="form-error" role="alert">{error}</div>}
          {notice && <div className="admin-notice" role="status">{notice}</div>}
          <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={busy}>Close</button><button className="button button-primary" disabled={busy}>{busy ? 'Updating…' : 'Change password'}</button></div>
        </form>
      </section>
    </div>
  )
}
