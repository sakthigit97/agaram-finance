import { createHmac } from 'node:crypto'
import { badRequest } from '../errors/app-error.js'

export function normalizePhone(value: string) {
  let digits = value.trim().replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (!/^[6-9]\d{9}$/.test(digits)) {
    throw badRequest('Enter a valid 10-digit Indian mobile number without a country code.')
  }
  return digits
}

export function normalizeLocalPhone(value: string) {
  const digits = value.trim().replace(/\D/g, '')
  if (!/^[6-9]\d{9}$/.test(digits)) {
    throw badRequest('Enter a valid 10-digit Indian mobile number without a country code.')
  }
  return digits
}

export function legacyPhoneCandidates(phone: string) {
  return [phone, `+91${phone}`]
}

export function displayPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 10) return digits
  return value
}

export function phoneLookupKey(phone: string, secret: Uint8Array) {
  return createHmac('sha256', secret).update(phone).digest('hex')
}
