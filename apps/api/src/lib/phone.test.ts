import { describe, it, expect } from 'vitest'
import { normalizeKePhone, isSafaricom, validateSafaricomPhone } from './phone.js'

describe('normalizeKePhone', () => {
  it('normalizes every input format to +254XXXXXXXXX', () => {
    expect(normalizeKePhone('+254712345678')).toBe('+254712345678')
    expect(normalizeKePhone('254712345678')).toBe('+254712345678')
    expect(normalizeKePhone('0712345678')).toBe('+254712345678')
    expect(normalizeKePhone('712345678')).toBe('+254712345678')
    expect(normalizeKePhone('0110123456')).toBe('+254110123456')
    expect(normalizeKePhone('110123456')).toBe('+254110123456')
  })

  it('ignores spaces, dashes and parentheses', () => {
    expect(normalizeKePhone('0712 345 678')).toBe('+254712345678')
    expect(normalizeKePhone('+254-712-345-678')).toBe('+254712345678')
    expect(normalizeKePhone(' (0712) 345678 ')).toBe('+254712345678')
  })

  it('returns null for wrong lengths / garbage', () => {
    expect(normalizeKePhone('071234567')).toBeNull()     // too short (9 w/ leading 0)
    expect(normalizeKePhone('07123456789')).toBeNull()   // too long
    expect(normalizeKePhone('2547123456789')).toBeNull() // too long
    expect(normalizeKePhone('abcdefg')).toBeNull()
    expect(normalizeKePhone('')).toBeNull()
  })
})

describe('isSafaricom', () => {
  it('accepts approved Safaricom prefixes', () => {
    for (const p of ['110', '115', '700', '709', '719', '729', '740', '743', '745', '748', '757', '759', '768', '769', '790', '799']) {
      expect(isSafaricom(`+254${p}123456`)).toBe(true)
    }
  })

  it('rejects gaps within Safaricom ranges and other operators', () => {
    // gaps: 744, 749, 756, 760-767, 770-789, 116
    for (const p of ['116', '730', '733', '744', '749', '756', '762', '770', '780', '789']) {
      expect(isSafaricom(`+254${p}123456`)).toBe(false)
    }
  })

  it('rejects malformed input', () => {
    expect(isSafaricom('+25471234567')).toBe(false)
    expect(isSafaricom('0712345678')).toBe(false)
  })
})

describe('validateSafaricomPhone', () => {
  it('normalizes + accepts a valid Safaricom number in any format', () => {
    expect(validateSafaricomPhone('0712345678')).toEqual({ ok: true, e164: '+254712345678' })
  })
  it('rejects a non-Safaricom number with a clear message', () => {
    const r = validateSafaricomPhone('0733123456') // Airtel
    expect(r.ok).toBe(false)
  })
  it('rejects an unparseable number', () => {
    const r = validateSafaricomPhone('12345')
    expect(r.ok).toBe(false)
  })
})
