import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSessionToken, readSessionToken, saveSessionToken } from './session'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browser session token storage', () => {
  it('stores, reads, and clears the access token in tab-scoped storage', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    expect(saveSessionToken('short-lived-token')).toBe(true)
    expect(readSessionToken()).toEqual({ ok: true, token: 'short-lived-token' })
    expect(clearSessionToken()).toBe(true)
    expect(readSessionToken()).toEqual({ ok: true, token: null })
  })

  it('reports when browser storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('Storage unavailable') },
      setItem: () => { throw new Error('Storage unavailable') },
      removeItem: () => { throw new Error('Storage unavailable') },
    })

    expect(readSessionToken()).toEqual({ ok: false })
    expect(saveSessionToken('short-lived-token')).toBe(false)
    expect(clearSessionToken()).toBe(false)
  })
})
