export function formatMoney(paise: number) {
  const sign = paise < 0 ? '-' : ''
  const absolutePaise = Math.abs(paise)
  const rupees = Math.floor(absolutePaise / 100)
  const remainderPaise = absolutePaise % 100
  const formattedRupees = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees)
  return `${sign}${formattedRupees}${remainderPaise ? `.${String(remainderPaise).padStart(2, '0')}` : ''}`
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00`))
}

export function getLocalDate() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getBusinessDate(timeZone = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
}

export function parseRupeesToPaise(value: string) {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) return null
  const rupees = Number(match[1])
  const paise = Number((match[2] ?? '').padEnd(2, '0'))
  const total = rupees * 100 + paise
  return Number.isSafeInteger(total) ? total : null
}
