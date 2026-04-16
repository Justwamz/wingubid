import crypto from 'crypto'
import { pool } from '@betting/db'
import { verifyPassword } from '../lib/hash.js'
import { signAdminAccessToken } from '../lib/jwt.js'
import { AppError } from './auth.service.js'

export async function loginAdmin(
  email: string,
  password: string,
): Promise<{
  accessToken: string
  refreshToken: string
  admin: { id: string; name: string; email: string; role: string }
}> {
  const { rows } = await pool.query<{
    id: string
    role: string
    status: string
    password_hash: string
    name: string
    email: string
  }>(
    `SELECT id, role, status, password_hash, name, email
     FROM admin_users WHERE email = $1`,
    [email],
  )

  if (rows.length === 0) {
    throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
  }

  const admin = rows[0]
  const match = await verifyPassword(password, admin.password_hash)
  if (!match) {
    throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
  }

  if (admin.status === 'suspended') {
    throw new AppError('ACCOUNT_SUSPENDED', 'Admin account is suspended', 403)
  }

  const accessToken = signAdminAccessToken(admin.id, admin.role)

  const refreshToken = crypto.randomUUID()
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await pool.query(
    `INSERT INTO admin_refresh_tokens (admin_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [admin.id, tokenHash, expiresAt],
  )

  return {
    accessToken,
    refreshToken,
    admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
  }
}

export async function logoutAdmin(refreshToken: string): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
  await pool.query(
    'DELETE FROM admin_refresh_tokens WHERE token_hash = $1',
    [tokenHash],
  )
}
