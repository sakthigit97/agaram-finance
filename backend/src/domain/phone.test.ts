import { describe, expect, it } from 'vitest'
import { legacyPhoneCandidates, normalizeLocalPhone, normalizePhone } from './phone.js'

describe('phone normalization', () => {
  it('normalizes Indian mobile inputs to ten digits', () => {
    expect(normalizePhone('98402-61530')).toBe('9840261530')
    expect(normalizePhone('+91 98402-61530')).toBe('9840261530')
    expect(normalizePhone('00919840261530')).toBe('9840261530')
  })

  it('rejects invalid Indian mobile numbers', () => {
    expect(() => normalizePhone('12345')).toThrow('10-digit Indian mobile number')
    expect(() => normalizePhone('1234567890')).toThrow('10-digit Indian mobile number')
  })

  it('requires local ten-digit format when creating a user', () => {
    expect(normalizeLocalPhone('98402 61530')).toBe('9840261530')
    expect(() => normalizeLocalPhone('+91 98402 61530')).toThrow('without a country code')
  })

  it('requires local ten-digit format for login', () => {
    expect(() => normalizeLocalPhone('+91 98402 61530')).toThrow('without a country code')
  })

  it('checks both local and legacy login keys for uniqueness', () => {
    expect(legacyPhoneCandidates('9840261530')).toEqual(['9840261530', '+919840261530'])
  })
})
