import { describe, expect, it } from 'vitest'
import { formatMoney, parseRupeesToPaise } from './format'

describe('exact paise formatting and parsing', () => {
  it('formats paise without floating-point currency arithmetic', () => {
    expect(formatMoney(1_00_005)).toBe('₹1,000.05')
    expect(formatMoney(-50)).toBe('-₹0.50')
    expect(formatMoney(1_00_000)).toBe('₹1,000')
  })

  it('parses valid decimal rupee amounts to integer paise', () => {
    expect(parseRupeesToPaise('1000')).toBe(100_000)
    expect(parseRupeesToPaise('10.5')).toBe(1_050)
    expect(parseRupeesToPaise('10.05')).toBe(1_005)
  })

  it('rejects invalid or unsafe amounts', () => {
    expect(parseRupeesToPaise('-1')).toBeNull()
    expect(parseRupeesToPaise('1.234')).toBeNull()
    expect(parseRupeesToPaise('90071992547410')).toBeNull()
  })
})
