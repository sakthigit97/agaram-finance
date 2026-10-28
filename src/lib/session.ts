const SESSION_TOKEN_KEY = 'agaram.finance.accessToken'

export type SessionStorageResult =
  | { ok: true; token: string | null }
  | { ok: false }

export function readSessionToken(): SessionStorageResult {
  try {
    return { ok: true, token: sessionStorage.getItem(SESSION_TOKEN_KEY) }
  } catch {
    return { ok: false }
  }
}

export function saveSessionToken(token: string): boolean {
  try {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token)
    return true
  } catch {
    return false
  }
}

export function clearSessionToken(): boolean {
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
    return true
  } catch {
    return false
  }
}
