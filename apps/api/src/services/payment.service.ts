import crypto from 'node:crypto'
import { pool } from '@betting/db'
import { AppError } from '../lib/errors.js'
import { getProvider } from './providers/index.js'
import { creditDeposit, lockForWithdrawal, settleWithdrawal } from './wallet.service.js'
import { calculateTax } from './tax.service.js'

// ─── Deposit ────────────────────────────────────────────────────────────────

export async function initiateDeposit(
  playerId: string,
  amount: number,
  providerName: string,
): Promise<{ transactionId: string; providerRef: string }> {
  // Load player
  const { rows: pRows } = await pool.query<{
    id: string; phone: string; currency: string; country: string
  }>(
    `SELECT id, phone, currency, country FROM players WHERE id = $1`,
    [playerId],
  )
  if (pRows.length === 0) throw new AppError('NOT_FOUND', 'Player not found', 404)
  const player = pRows[0]

  // Check limits
  const { rows: limitRows } = await pool.query<{ min_deposit: number; max_deposit: number }>(
    `SELECT min_deposit, max_deposit FROM country_settings WHERE country = $1`,
    [player.country],
  )
  if (limitRows.length > 0) {
    const { min_deposit, max_deposit } = limitRows[0]
    if (amount < Number(min_deposit)) {
      throw new AppError('LIMIT_EXCEEDED', `Minimum deposit is ${min_deposit}`, 422)
    }
    if (max_deposit != null && amount > Number(max_deposit)) {
      throw new AppError('LIMIT_EXCEEDED', `Maximum deposit is ${max_deposit}`, 422)
    }
  }

  const idempotencyKey = `deposit:${playerId}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`

  // Insert payment_transactions — handle duplicate key (idempotency)
  let paymentTxId: string
  let providerRef: string

  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO payment_transactions
         (player_id, wallet_id, type, provider, amount, currency, idempotency_key, status)
       VALUES ($1, (SELECT id FROM wallets WHERE player_id = $1), 'deposit', $2, $3, $4, $5, 'pending')
       RETURNING id`,
      [playerId, providerName, amount, player.currency, idempotencyKey],
    )
    paymentTxId = rows[0].id
  } catch (err: any) {
    if (err.code === '23505') {
      // Unique constraint — return existing record
      const { rows } = await pool.query<{ id: string; provider_ref: string }>(
        `SELECT id, provider_ref FROM payment_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
      return { transactionId: rows[0].id, providerRef: rows[0].provider_ref }
    }
    throw err
  }

  // Call provider
  const provider = getProvider(providerName)
  const result = await provider.deposit({
    playerId,
    phone: player.phone,
    amount,
    currency: player.currency,
    reference: paymentTxId,
  })
  providerRef = result.providerRef

  // Update to awaiting_callback
  await pool.query(
    `UPDATE payment_transactions
     SET status = 'awaiting_callback', provider_ref = $1, updated_at = NOW()
     WHERE id = $2`,
    [providerRef, paymentTxId],
  )

  return { transactionId: paymentTxId, providerRef }
}

export async function confirmDeposit(
  providerRef: string,
  success: boolean,
  failureReason?: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query<{
      id: string; player_id: string; amount: number; status: string
    }>(
      `SELECT id, player_id, amount, status FROM payment_transactions
       WHERE provider_ref = $1 FOR UPDATE`,
      [providerRef],
    )

    if (rows.length === 0) {
      console.warn(`[payment] confirmDeposit: unknown providerRef ${providerRef}`)
      await client.query('COMMIT')
      return
    }

    const pt = rows[0]

    if (pt.status === 'completed' || pt.status === 'failed') {
      await client.query('COMMIT')
      return
    }

    if (success) {
      await creditDeposit(client, pt.player_id, Number(pt.amount), pt.id, { providerRef })
      await client.query(
        `UPDATE payment_transactions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [pt.id],
      )
    } else {
      await client.query(
        `UPDATE payment_transactions
         SET status = 'failed', failure_reason = $1, updated_at = NOW()
         WHERE id = $2`,
        [failureReason ?? 'Provider declined', pt.id],
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Withdrawal ─────────────────────────────────────────────────────────────

export async function initiateWithdrawal(
  playerId: string,
  amount: number,
  providerName: string,
): Promise<{ transactionId: string; providerRef: string }> {
  const { rows: pRows } = await pool.query<{
    id: string; phone: string; currency: string; country: string
  }>(
    `SELECT id, phone, currency, country FROM players WHERE id = $1`,
    [playerId],
  )
  if (pRows.length === 0) throw new AppError('NOT_FOUND', 'Player not found', 404)
  const player = pRows[0]

  // Check limits
  const { rows: limitRows } = await pool.query<{
    min_withdrawal: number; max_withdrawal: number; daily_withdrawal_limit: number
  }>(
    `SELECT min_withdrawal, max_withdrawal, daily_withdrawal_limit
     FROM country_settings WHERE country = $1`,
    [player.country],
  )
  if (limitRows.length > 0) {
    const { min_withdrawal, max_withdrawal, daily_withdrawal_limit } = limitRows[0]
    if (amount < Number(min_withdrawal)) {
      throw new AppError('LIMIT_EXCEEDED', `Minimum withdrawal is ${min_withdrawal}`, 422)
    }
    if (max_withdrawal != null && amount > Number(max_withdrawal)) {
      throw new AppError('LIMIT_EXCEEDED', `Maximum withdrawal is ${max_withdrawal}`, 422)
    }
    if (daily_withdrawal_limit != null) {
      const { rows: dailyRows } = await pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM payment_transactions
         WHERE player_id = $1 AND type = 'withdrawal' AND status = 'completed'
         AND created_at >= (CURRENT_DATE AT TIME ZONE 'Africa/Nairobi')`,
        [playerId],
      )
      const dailyTotal = Number(dailyRows[0].total)
      if (dailyTotal + amount > Number(daily_withdrawal_limit)) {
        throw new AppError('LIMIT_EXCEEDED', 'Daily withdrawal limit exceeded', 422)
      }
    }
  }

  // Calculate withdrawal tax
  const { taxAmount, effectiveAmount: netPayout } = await calculateTax(
    player.country, 'withdrawal_tax', amount,
  )

  const idempotencyKey = `withdrawal:${playerId}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`

  // Lock funds and create payment record in one transaction
  const client = await pool.connect()
  let paymentTxId: string
  try {
    await client.query('BEGIN')
    const { walletId } = await lockForWithdrawal(client, playerId, amount)

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO payment_transactions
         (player_id, wallet_id, type, provider, amount, currency, idempotency_key, status)
       VALUES ($1, $2, 'withdrawal', $3, $4, $5, $6, 'pending')
       RETURNING id`,
      [playerId, walletId, providerName, amount, player.currency, idempotencyKey],
    )
    paymentTxId = rows[0].id
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  // Call provider (outside transaction)
  const provider = getProvider(providerName)
  const result = await provider.withdraw({
    playerId,
    phone: player.phone,
    amount: netPayout,
    currency: player.currency,
    reference: paymentTxId,
  })
  const providerRef = result.providerRef

  await pool.query(
    `UPDATE payment_transactions
     SET status = 'awaiting_callback', provider_ref = $1, updated_at = NOW()
     WHERE id = $2`,
    [providerRef, paymentTxId],
  )

  // Cache netPayout in failure_reason field so confirmWithdrawal knows the net amount
  await pool.query(
    `UPDATE payment_transactions SET failure_reason = $1 WHERE id = $2`,
    [JSON.stringify({ netPayout, taxAmount }), paymentTxId],
  )

  return { transactionId: paymentTxId, providerRef }
}

export async function confirmWithdrawal(
  providerRef: string,
  success: boolean,
  failureReason?: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query<{
      id: string; player_id: string; amount: number; status: string; failure_reason: string | null
    }>(
      `SELECT id, player_id, amount, status, failure_reason
       FROM payment_transactions WHERE provider_ref = $1 FOR UPDATE`,
      [providerRef],
    )

    if (rows.length === 0) {
      console.warn(`[payment] confirmWithdrawal: unknown providerRef ${providerRef}`)
      await client.query('COMMIT')
      return
    }

    const pt = rows[0]

    if (pt.status === 'completed' || pt.status === 'failed') {
      await client.query('COMMIT')
      return
    }

    // Parse cached netPayout from failure_reason field (set during initiation)
    const meta = pt.failure_reason ? JSON.parse(pt.failure_reason) : {}
    const netPayout = meta.netPayout ?? Number(pt.amount)

    await settleWithdrawal(client, pt.player_id, Number(pt.amount), netPayout, success, { providerRef })

    await client.query(
      `UPDATE payment_transactions
       SET status = $1, failure_reason = $2, updated_at = NOW()
       WHERE id = $3`,
      [success ? 'completed' : 'failed', success ? null : (failureReason ?? 'Provider declined'), pt.id],
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
