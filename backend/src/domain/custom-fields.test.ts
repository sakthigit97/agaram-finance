import { describe, expect, it } from 'vitest'
import { updateCustomFields, validateCustomFields, validateTemplate } from './custom-fields.js'

describe('custom fields', () => {
  it('validates values against admin-defined, reusable templates', () => {
    const template = validateTemplate([
      { key: 'occupation', label: 'Occupation', type: 'text', required: true },
      { key: 'memberSince', label: 'Member since', type: 'date', required: false },
      { key: 'creditScore', label: 'Credit score', type: 'number', required: false },
      { key: 'verified', label: 'Verified', type: 'boolean', required: false },
    ])

    expect(validateCustomFields({
      occupation: 'Teacher',
      memberSince: '2025-03-01',
      creditScore: 720,
      verified: true,
    }, template)).toEqual({
      occupation: 'Teacher',
      memberSince: '2025-03-01',
      creditScore: 720,
      verified: true,
    })
  })

  it('rejects unknown keys, missing required values, and type mismatches', () => {
    const template = validateTemplate([
      { key: 'memberCode', label: 'Member code', type: 'text', required: true },
    ])
    expect(() => validateCustomFields({ isAdmin: true }, template)).toThrow('Unknown custom field(s)')
    expect(() => validateCustomFields({}, template)).toThrow('"Member code" is required.')
    expect(() => validateCustomFields({ memberCode: 123 }, template)).toThrow('"Member code" must be a valid text value.')
  })

  it('rejects duplicate and reserved custom field names', () => {
    expect(() => validateTemplate([
      { key: 'area', label: 'Area', type: 'text', required: false },
    ])).toThrow('"area" is a reserved field name.')
    expect(() => validateTemplate([
      { key: 'memberCode', label: 'One', type: 'text', required: false },
      { key: 'memberCode', label: 'Two', type: 'text', required: false },
    ])).toThrow('is duplicated.')
  })

  it('clears optional custom fields and preserves retired values during edits', () => {
    const template = validateTemplate([
      { key: 'note', label: 'Note', type: 'text', required: false },
      { key: 'verified', label: 'Verified', type: 'boolean', required: false },
    ])
    expect(updateCustomFields(
      { note: 'old', verified: true, retired: 'keep' },
      { note: null, verified: false },
      template,
    )).toEqual({ verified: false, retired: 'keep' })
  })

  it('does not allow clearing required custom fields', () => {
    const template = validateTemplate([
      { key: 'memberCode', label: 'Member code', type: 'text', required: true },
    ])
    expect(() => updateCustomFields({ memberCode: 'A1' }, { memberCode: null }, template))
      .toThrow('"Member code" is required.')
  })
})
