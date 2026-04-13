import bcrypt from 'bcryptjs'
import { pool } from '@betting/db'

export async function generateOtp(
  phone: string,
  purpose: 'registration' | 'password_reset',
): Promise<string> {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const codeHash = await bcrypt.hash(code, 10)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  await pool.query(
    `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [phone, codeHash, purpose, expiresAt],
  )

  return code
}

export async function verifyOtp(
  phone: string,
  code: string,
  purpose: 'registration' | 'password_reset',
): Promise<boolean> {
  const { rows } = await pool.query<{ id: string; code_hash: string }>(
    `SELECT id, code_hash FROM otp_codes
     WHERE phone = $1
       AND purpose = $2
       AND used_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [phone, purpose],
  )

  if (rows.length === 0) return false

  const match = await bcrypt.compare(code, rows[0].code_hash)
  if (!match) return false

  await pool.query(
    `UPDATE otp_codes SET used_at = NOW() WHERE id = $1`,
    [rows[0].id],
  )

  return true
}
