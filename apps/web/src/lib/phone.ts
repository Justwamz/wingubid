// Kenya / Safaricom phone-number helpers (mirrors apps/api/src/lib/phone.ts).
//
// Safaricom subscriber prefixes (first 3 digits after +254), from the national
// list: 0110–0115, 0700–0729, 0740–0743, 0745–0748, 0757–0759, 0768–0769, 0790–0799
const SAFARICOM_PREFIXES: ReadonlySet<string> = (() => {
  const s = new Set<string>()
  const addRange = (a: number, b: number) => { for (let n = a; n <= b; n++) s.add(String(n)) }
  addRange(110, 115)
  addRange(700, 729)
  addRange(740, 743)
  addRange(745, 748)
  addRange(757, 759)
  addRange(768, 769)
  addRange(790, 799)
  return s
})()

/** Normalize a Kenyan mobile number to E.164 (+254 + 9 digits), or null. */
export function normalizeKePhone(input: string): string | null {
  if (!input) return null
  let d = input.trim().replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  if (!/^\d+$/.test(d)) return null

  let sub: string
  if (d.length === 12 && d.startsWith('254')) sub = d.slice(3)
  else if (d.length === 10 && d.startsWith('0')) sub = d.slice(1)
  else if (d.length === 9) sub = d
  else return null

  // Kenyan mobile subscriber numbers are 9 digits beginning with 7 or 1.
  return /^[17]\d{8}$/.test(sub) ? `+254${sub}` : null
}

/** True if a normalized +254 number is an approved Safaricom prefix. */
export function isSafaricom(e164: string): boolean {
  const m = /^\+254(\d{9})$/.exec(e164)
  return m ? SAFARICOM_PREFIXES.has(m[1].slice(0, 3)) : false
}

/** Validate + normalize as a Safaricom mobile number. */
export function validateSafaricomPhone(input: string): { ok: true; e164: string } | { ok: false; error: string } {
  const e164 = normalizeKePhone(input)
  if (!e164) return { ok: false, error: 'Enter a valid phone number' }
  if (!isSafaricom(e164)) return { ok: false, error: 'Only Safaricom numbers are currently supported' }
  return { ok: true, e164 }
}
