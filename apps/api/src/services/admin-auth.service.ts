import crypto from 'crypto'
import { pool } from '@betting/db'
import { signAdminAccessToken } from '../lib/jwt.js'
import { AppError } from './auth.service.js'
import { authenticateStaff } from './staff-auth.service.js'

export async function loginAdmin(
  email: string,
  password: string,
): Promise<{
  accessToken: string
  refreshToken: string
  admin: { id: string; name: string; email: string; role: string }
  mustChangePassword: boolean
}> {
  const staff = await authenticateStaff(email, password)

  const accessToken = signAdminAccessToken(staff.id, staff.role)

  const refreshToken = crypto.randomUUID()
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await pool.query(
    `INSERT INTO admin_refresh_tokens (admin_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [staff.id, tokenHash, expiresAt],
  )
  await pool.query(`UPDATE admin_users SET last_login_at = NOW() WHERE id = $1`, [staff.id])

  return {
    accessToken,
    refreshToken,
    admin: { id: staff.id, name: staff.name, email: staff.email, role: staff.role },
    mustChangePassword: staff.mustChangePassword,
  }
}

export async function logoutAdmin(refreshToken: string): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
  await pool.query('DELETE FROM admin_refresh_tokens WHERE token_hash = $1', [tokenHash])
}
