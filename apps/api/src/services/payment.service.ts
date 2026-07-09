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
  // A client-supplied Idempotency-Key collapses retries of the same intended
  // deposit onto one payment_transactions row (ON CONFLICT returns the existing
  // one) instead of creating a new pending row per attempt.
  clientIdempotencyKey?: string,
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
      throw new AppError('LIMIT_EXCEEDED', `The smallest deposit you can make is KES ${(Number(min_deposit) / 100).toLocaleString('en-KE')}.`, 422)
    }
    if (max_deposit != null && amount > Number(max_deposit)) {
      throw new AppError('LIMIT_EXCEEDED', `The largest deposit you can make is KES ${(Number(max_deposit) / 100).toLocaleString('en-KE')}.`, 422)
    }
  }

  const idempotencyKey = clientIdempotencyKey
    ? `deposit:${playerId}:${clientIdempotencyKey}`
    : `deposit:${playerId}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`

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
  // What the provider says was actually collected. When supplied, it MUST match
  // the amount/currency we recorded at initiation before we credit — otherwise a
  // partial/mismatched payment could credit the full requested amount.
  confirmed?: { amount?: number; currency?: string },
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query<{
      id: string; player_id: string; amount: number; currency: string; status: string
    }>(
      `SELECT id, player_id, amount, currency, status FROM payment_transactions
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

    // Reject a "successful" callback whose confirmed amount/currency doesn't
    // match what we recorded — never credit the requested amount for a partial
    // or wrong-currency payment.
    const amountMismatch = confirmed?.amount != null && confirmed.amount !== Number(pt.amount)
    const currencyMismatch = confirmed?.currency != null && confirmed.currency !== pt.currency
    if (success && (amountMismatch || currencyMismatch)) {
      const reason = amountMismatch
        ? `amount mismatch: provider ${confirmed?.amount} vs expected ${pt.amount}`
        : `currency mismatch: provider ${confirmed?.currency} vs expected ${pt.currency}`
      console.warn(`[payment] confirmDeposit rejected — ${reason} (ref ${providerRef})`)
      await client.query(
        `UPDATE payment_transactions SET status = 'failed', failure_reason = $1, updated_at = NOW() WHERE id = $2`,
        [reason, pt.id],
      )
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
      throw new AppError('LIMIT_EXCEEDED', `The smallest withdrawal you can make is KES ${(Number(min_withdrawal) / 100).toLocaleString('en-KE')}.`, 422)
    }
    if (max_withdrawal != null && amount > Number(max_withdrawal)) {
      throw new AppError('LIMIT_EXCEEDED', `The largest withdrawal you can make is KES ${(Number(max_withdrawal) / 100).toLocaleString('en-KE')}.`, 422)
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
        throw new AppError('LIMIT_EXCEEDED', "You've reached your withdrawal limit for today. Please try again tomorrow.", 422)
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
         (player_id, wallet_id, type, provider, amount, currency, idempotency_key, status, net_amount, tax_amount)
       VALUES ($1, $2, 'withdrawal', $3, $4, $5, $6, 'pending', $7, $8)
       RETURNING id`,
      [playerId, walletId, providerName, amount, player.currency, idempotencyKey, netPayout, taxAmount],
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
      id: string; player_id: string; amount: number; status: string; net_amount: number | null
    }>(
      `SELECT id, player_id, amount, status, net_amount
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

    const netPayout = pt.net_amount != null ? Number(pt.net_amount) : Number(pt.amount)

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
