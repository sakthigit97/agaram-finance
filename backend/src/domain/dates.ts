import { badRequest } from '../errors/app-error.js'

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function requireIsoDate(value: string, name: string) {
  if (!isIsoDate(value)) throw badRequest(`${name} must be a valid YYYY-MM-DD date.`)
  return value
}

export function addCalendarDays(date: string, days: number) {
  const result = new Date(`${date}T00:00:00.000Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

export function addCalendarMonths(date: string, months: number) {
  const start = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime())) throw badRequest('Cannot calculate a monthly due date from an invalid date.')
  const day = start.getUTCDate()
  const monthIndex = start.getUTCMonth() + months
  const year = start.getUTCFullYear() + Math.floor(monthIndex / 12)
  const month = ((monthIndex % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10)
}

export function businessDate(timeZone: string, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
