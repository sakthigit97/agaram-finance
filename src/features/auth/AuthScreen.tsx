import { useState, type FormEvent } from 'react'
import { api, ApiError, type ApiPrincipal } from '../../lib/api'

export function AuthScreen({
  onAuthenticated,
  initialError = '',
}: {
  onAuthenticated: (token: string, principal: ApiPrincipal) => void
  initialError?: string
}) {
  const [token, setToken] = useState('')
  const [principal, setPrincipal] = useState<ApiPrincipal | null>(null)
  const [error, setError] = useState(initialError)
  const [busy, setBusy] = useState(false)

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    const data = new FormData(event.currentTarget)
    try {
      const result = await api.login(String(data.get('phone') ?? '').trim(), String(data.get('password') ?? ''))
      const principal = await api.me(result.accessToken)
      if (principal.passwordChangeRequired) {
        setToken(result.accessToken)
        setPrincipal(principal)
      } else {
        onAuthenticated(result.accessToken, principal)
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to reach Agaram Finance. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    const data = new FormData(event.currentTarget)
    const currentPassword = String(data.get('currentPassword') ?? '')
    const newPassword = String(data.get('newPassword') ?? '')
    if (newPassword !== String(data.get('confirmPassword') ?? '')) {
      setError('The new passwords do not match.')
      setBusy(false)
      return
    }
    try {
      await api.changePassword(token, currentPassword, newPassword)
      if (principal) onAuthenticated(token, { ...principal, passwordChangeRequired: false })
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to change the password. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="brand auth-brand">
          <span className="brand-mark">a</span>
          <span className="brand-name">agaram<span>finance</span></span>
        </div>
        {principal ? (
          <>
            <p className="eyebrow">ACCOUNT SECURITY</p>
            <h1>Set a new password</h1>
            <p className="auth-description">Your temporary password must be replaced before you can continue.</p>
            <form className="auth-form" onSubmit={changePassword}>
              <label className="form-field">Temporary password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
              <label className="form-field">New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
              <label className="form-field">Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
              {error && <div className="form-error" role="alert">{error}</div>}
              <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
            </form>
          </>
        ) : (
          <>
            <p className="eyebrow">SECURE BUSINESS WORKSPACE</p>
            <h1>Welcome back</h1>
            <p className="auth-description">Sign in to manage your customers, loans, and collections.</p>
            <form className="auth-form" onSubmit={login}>
              <label className="form-field">Mobile number<input name="phone" type="tel" autoComplete="username" inputMode="numeric" pattern="[6-9][0-9]{9}" maxLength={10} placeholder="10-digit mobile number" required autoFocus /></label>
              <label className="form-field">Password<input name="password" type="password" autoComplete="current-password" required /></label>
              {error && <div className="form-error" role="alert">{error}</div>}
              <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </form>
          </>
        )}
      </section>
    </main>
  )
}
