import crypto from 'crypto'
import { pool } from '@betting/db'
import { hashPassword, verifyPassword } from '../lib/hash.js'
import { signPlayerAccessToken } from '../lib/jwt.js'
import { generateOtp, verifyOtp } from './otp.service.js'
import { sendSms } from './sms.service.js'
import { env } from '../env.js'

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message)
  }
}

export interface RegisterInput {
  phone: string
  name: string
  country: string
  currency: string
  date_of_birth: string
  password: string
}

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  KE: 'KES',
  UG: 'UGX',
  TZ: 'TZS',
  RW: 'RWF',
}

export async function registerPlayer(
  input: RegisterInput,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const client = await pool.connect()
  let committed = false
  let playerId: string
  try {
    await client.query('BEGIN')

    const existing = await client.query(
      'SELECT id FROM players WHERE phone = $1',
      [input.phone],
    )
    if (existing.rows.length > 0) {
      throw new AppError('PHONE_TAKEN', 'Phone number already registered', 409)
    }

    const passwordHash = await hashPassword(input.password)
    const currency = CURRENCY_BY_COUNTRY[input.country] ?? input.currency

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO players (phone, name, country, currency, date_of_birth, password_hash${env.SMS_ENABLED ? '' : ', phone_verified_at'})
       VALUES ($1, $2, $3, $4, $5, $6${env.SMS_ENABLED ? '' : ', NOW()'})
       RETURNING id`,
      [input.phone, input.name, input.country, currency, input.date_of_birth, passwordHash],
    )
    playerId = rows[0].id

    await client.query(
      `INSERT INTO wallets (player_id, currency) VALUES ($1, $2)`,
      [playerId, currency],
    )

    await client.query('COMMIT')
    committed = true
  } catch (err) {
    if (!committed) {
      await client.query('ROLLBACK')
    }
    throw err
  } finally {
    client.release()
  }

  if (!env.SMS_ENABLED) {
    return issueTokens(playerId)
  }

  const code = await generateOtp(input.phone, 'registration')
  await sendSms(input.phone, `Your verification code is ${code}. Valid for 10 minutes.`)
  return null
}

export async function verifyPlayerOtp(
  phone: string,
  code: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const valid = await verifyOtp(phone, code, 'registration')
  if (!valid) {
    throw new AppError('INVALID_OTP', 'Invalid or expired OTP', 400)
  }

  const { rows } = await pool.query<{ id: string }>(
    `UPDATE players SET phone_verified_at = NOW()
     WHERE phone = $1 AND phone_verified_at IS NULL
     RETURNING id`,
    [phone],
  )
  if (rows.length === 0) {
    throw new AppError('INVALID_OTP', 'Invalid or expired OTP', 400)
  }

  const playerId = rows[0].id
  return issueTokens(playerId)
}

export async function loginPlayer(
  phone: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const { rows } = await pool.query<{
    id: string
    password_hash: string
    phone_verified_at: Date | null
    status: string
  }>(
    `SELECT id, password_hash, phone_verified_at, status FROM players WHERE phone = $1`,
    [phone],
  )

  if (rows.length === 0) {
    throw new AppError('INVALID_CREDENTIALS', 'Invalid phone or password', 401)
  }

  const player = rows[0]

  const match = await verifyPassword(password, player.password_hash)
  if (!match) {
    throw new AppError('INVALID_CREDENTIALS', 'Invalid phone or password', 401)
  }

  if (!player.phone_verified_at && env.SMS_ENABLED) {
    throw new AppError('PHONE_NOT_VERIFIED', 'Phone not verified — check your OTP', 403)
  }

  if (player.status === 'suspended') {
    throw new AppError('ACCOUNT_SUSPENDED', 'Account is suspended', 403)
  }

  return issueTokens(player.id)
}

export async function refreshPlayerTokens(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const tokenHash = hashRefreshToken(refreshToken)

  const { rows } = await pool.query<{ id: string; player_id: string; expires_at: Date }>(
    `SELECT id, player_id, expires_at FROM refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash],
  )

  if (rows.length === 0 || rows[0].expires_at < new Date()) {
    throw new AppError('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token', 401)
  }

  const { id: tokenId, player_id: playerId } = rows[0]

  await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [tokenId])

  return issueTokens(playerId)
}

export async function logoutPlayer(refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken)
  await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash])
}

async function issueTokens(
  playerId: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signPlayerAccessToken(playerId)

  const refreshToken = crypto.randomUUID()
  const tokenHash = hashRefreshToken(refreshToken)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  await pool.query(
    `INSERT INTO refresh_tokens (player_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [playerId, tokenHash, expiresAt],
  )

  return { accessToken, refreshToken }
}

function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
