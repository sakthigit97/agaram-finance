import { z } from 'zod'
import { badRequest } from '../errors/app-error.js'

export const customFieldTypeSchema = z.enum(['text', 'number', 'boolean', 'date'])

export const customFieldDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(80),
  type: customFieldTypeSchema,
  required: z.boolean().default(false),
}).strict()

export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>
export type CustomFields = Record<string, string | number | boolean>

const reservedFieldKeys = new Set([
  'id', 'customerId', 'loanId', 'phone', 'name', 'area', 'address', 'notes',
  'type', 'status', 'principalPaise', 'upfrontInterestPaise', 'bookFeePaise',
  'monthlyInterestPaise', 'targetPaise', 'collectedPaise', 'disbursedPaise',
  'customFields', 'createdAt', 'updatedAt', 'version',
])

export function validateTemplate(value: unknown): CustomFieldDefinition[] {
  const parsed = z.array(customFieldDefinitionSchema).max(40).safeParse(value)
  if (!parsed.success) throw badRequest('Custom-field template is invalid.')
  const keys = new Set<string>()
  for (const field of parsed.data) {
    if (reservedFieldKeys.has(field.key)) {
      throw badRequest(`"${field.key}" is a reserved field name.`)
    }
    if (keys.has(field.key)) throw badRequest(`Custom-field key "${field.key}" is duplicated.`)
    keys.add(field.key)
  }
  return parsed.data
}

export function validateCustomFields(
  input: unknown,
  template: CustomFieldDefinition[],
  requireRequired = true,
): CustomFields {
  if (input === undefined) input = {}
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('customFields must be an object.')
  }
  const supplied = input as Record<string, unknown>
  const allowed = new Set(template.map((field) => field.key))
  const unknownKeys = Object.keys(supplied).filter((key) => !allowed.has(key))
  if (unknownKeys.length > 0) {
    throw badRequest(`Unknown custom field(s): ${unknownKeys.join(', ')}.`)
  }

  const result: CustomFields = {}
  for (const field of template) {
    const value = supplied[field.key]
    if (value === undefined) {
      if (field.required && requireRequired) throw badRequest(`"${field.label}" is required.`)
      continue
    }
    let valid = false
    switch (field.type) {
      case 'text':
        valid = typeof value === 'string' && value.length <= 500
        break
      case 'number':
        valid = typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
        break
      case 'boolean':
        valid = typeof value === 'boolean'
        break
      case 'date':
        valid = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
          && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
          && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
        break
    }
    if (!valid) throw badRequest(`"${field.label}" must be a valid ${field.type} value.`)
    result[field.key] = value as string | number | boolean
  }
  return result
}

export function updateCustomFields(
  current: CustomFields,
  input: unknown,
  template: CustomFieldDefinition[],
): CustomFields {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('customFields must be an object.')
  }
  const supplied = input as Record<string, unknown>
  const clearKeys = Object.keys(supplied).filter((key) => supplied[key] === null)
  const definitions = new Map(template.map((field) => [field.key, field]))
  for (const key of clearKeys) {
    const definition = definitions.get(key)
    if (!definition) throw badRequest(`Unknown custom field(s): ${key}.`)
    if (definition.required) throw badRequest(`"${definition.label}" is required.`)
  }
  const values = Object.fromEntries(Object.entries(supplied).filter(([, value]) => value !== null))
  const updated = { ...current, ...validateCustomFields(values, template, false) }
  for (const key of clearKeys) delete updated[key]
  return updated
}
