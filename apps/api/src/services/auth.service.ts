import crypto from 'crypto'
import { pool } from '@betting/db'
import { hashPassword, verifyPassword } from '../lib/hash.js'
import { signPlayerAccessToken } from '../lib/jwt.js'
import { generateOtp, verifyOtp } from './otp.service.js'
import { sendSms } from './sms.service.js'
import { smsEnabled } from './sms-config.service.js'
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
  ip?: string
  deviceId?: string
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
  // Live OTP is controlled by the admin SMS config, not an env flag. When off,
  // we auto-verify the phone and sign the player in immediately (demo).
  const smsOn = await smsEnabled()
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
      `INSERT INTO players (phone, name, country, currency, date_of_birth, password_hash${smsOn ? '' : ', phone_verified_at'})
       VALUES ($1, $2, $3, $4, $5, $6${smsOn ? '' : ', NOW()'})
       RETURNING id`,
      [input.phone, input.name, input.country, currency, input.date_of_birth, passwordHash],
    )
    playerId = rows[0].id

    const { rows: walletRows } = await client.query<{ id: string }>(
      `INSERT INTO wallets (player_id, currency) VALUES ($1, $2) RETURNING id`,
      [playerId, currency],
    )

    if (env.DEMO_MODE) {
      await client.query(
        `UPDATE wallets SET balance = 1000000 WHERE id = $1`,
        [walletRows[0].id],
      )
    }

    // Abuse signal: record the signup IP + device for later bonus eligibility
    // checks. Best-effort; only write when we actually have something.
    if (input.ip || input.deviceId) {
      await client.query(
        `INSERT INTO player_signals (player_id, kind, ip, device_id)
         VALUES ($1, 'signup', $2, $3)`,
        [playerId, input.ip ?? null, input.deviceId ? input.deviceId.slice(0, 64) : null],
      )
    }

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

  if (!smsOn) {
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
    throw new AppError('INVALID_OTP', 'That verification code is incorrect or has expired. Please request a new one.', 400)
  }

  const { rows } = await pool.query<{ id: string }>(
    `UPDATE players SET phone_verified_at = NOW()
     WHERE phone = $1 AND phone_verified_at IS NULL
     RETURNING id`,
    [phone],
  )
  if (rows.length === 0) {
    throw new AppError('INVALID_OTP', 'That verification code is incorrect or has expired. Please request a new one.', 400)
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

  if (!player.phone_verified_at && await smsEnabled()) {
    throw new AppError('PHONE_NOT_VERIFIED', "Your phone number isn't verified yet. Please enter the verification code we sent you.", 403)
  }

  if (player.status === 'suspended') {
    throw new AppError('ACCOUNT_SUSPENDED', 'Your account has been suspended. Please contact support.', 403)
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
    throw new AppError('INVALID_REFRESH_TOKEN', 'Your session has expired. Please log in again.', 401)
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
