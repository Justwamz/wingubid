import { pool } from '@betting/db'
import { creditDeposit } from './wallet.service.js'
import { normalizeKePhone } from '../lib/phone.js'
import { AppError } from '../lib/errors.js'
import { maybeGrantDepositMatch } from './deposit-match.service.js'

export type C2bStatus = 'credited' | 'unresolved' | 'reposted' | 'refunded'

export interface C2bResult {
  status: C2bStatus
  duplicate?: boolean
  playerId?: string
}

/**
 * Record a paybill (C2B) payment. If the paying number matches a registered
 * player, credit their wallet directly; otherwise hold it as unresolved for
 * manual reconciliation. Idempotent on the M-Pesa receipt.
 */
export async function recordC2bPayment(params: {
  msisdn: string
  amount: number
  mpesaReceipt: string
}): Promise<C2bResult> {
  const { amount, mpesaReceipt } = params
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AppError('INVALID_AMOUNT', 'Invalid payment amount.', 400)
  }
  const msisdn = normalizeKePhone(params.msisdn) ?? params.msisdn

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Idempotency: if this receipt was already recorded, do nothing.
    const dup = await client.query<{ status: C2bStatus }>(
      `SELECT status FROM c2b_payments WHERE mpesa_receipt = $1 FOR UPDATE`,
      [mpesaReceipt],
    )
    if (dup.rows.length > 0) {
      await client.query('COMMIT')
      return { status: dup.rows[0].status, duplicate: true }
    }

    const player = await client.query<{ id: string }>(
      `SELECT id FROM players WHERE phone = $1`,
      [msisdn],
    )

    if (player.rows.length > 0) {
      const playerId = player.rows[0].id
      await creditDeposit(client, playerId, amount, `c2b:${mpesaReceipt}`, {
        source: 'c2b', msisdn, mpesaReceipt,
      })
      await client.query(
        `INSERT INTO c2b_payments (msisdn, amount, mpesa_receipt, status, player_id)
         VALUES ($1, $2, $3, 'credited', $4)`,
        [msisdn, amount, mpesaReceipt, playerId],
      )
      await client.query('COMMIT')
      await maybeGrantDepositMatch(playerId, amount)
      return { status: 'credited', playerId }
    }

    await client.query(
      `INSERT INTO c2b_payments (msisdn, amount, mpesa_receipt, status)
       VALUES ($1, $2, $3, 'unresolved')`,
      [msisdn, amount, mpesaReceipt],
    )
    await client.query('COMMIT')
    return { status: 'unresolved' }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export interface C2bPaymentRow {
  id: string
  msisdn: string
  amount: number
  mpesaReceipt: string
  status: C2bStatus
  playerPhone: string | null
  resolvedAt: string | null
  createdAt: string
}

export async function listC2bPayments(): Promise<{
  payments: C2bPaymentRow[]
  totals: { uncredited: number; refunded: number; credited: number }
}> {
  const { rows } = await pool.query(
    `SELECT c.id, c.msisdn, c.amount, c.mpesa_receipt, c.status,
            p.phone AS player_phone, c.resolved_at, c.created_at
     FROM c2b_payments c
     LEFT JOIN players p ON p.id = c.player_id
     ORDER BY c.created_at DESC
     LIMIT 100`,
  )
  const { rows: sums } = await pool.query<{ status: C2bStatus; total: string }>(
    `SELECT status, COALESCE(SUM(amount), 0) AS total FROM c2b_payments GROUP BY status`,
  )
  const by = new Map(sums.map(s => [s.status, Number(s.total)]))
  return {
    payments: rows.map(r => ({
      id: r.id,
      msisdn: r.msisdn,
      amount: Number(r.amount),
      mpesaReceipt: r.mpesa_receipt,
      status: r.status,
      playerPhone: r.player_phone,
      resolvedAt: r.resolved_at,
      createdAt: r.created_at,
    })),
    totals: {
      uncredited: by.get('unresolved') ?? 0,
      refunded: by.get('refunded') ?? 0,
      credited: (by.get('credited') ?? 0) + (by.get('reposted') ?? 0),
    },
  }
}

/** Credit an unresolved payment to a user identified by phone (admin action). */
export async function repostC2bPayment(id: string, phone: string, adminId: string): Promise<void> {
  const normalized = normalizeKePhone(phone) ?? phone
  const client = await pool.connect()
  let credited: { playerId: string; amount: number } | null = null
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ amount: string; mpesa_receipt: string; status: C2bStatus }>(
      `SELECT amount, mpesa_receipt, status FROM c2b_payments WHERE id = $1 FOR UPDATE`,
      [id],
    )
    if (rows.length === 0) throw new AppError('NOT_FOUND', 'Payment not found.', 404)
    if (rows[0].status !== 'unresolved') {
      throw new AppError('ALREADY_RESOLVED', 'This payment has already been resolved.', 422)
    }

    const player = await client.query<{ id: string }>(`SELECT id FROM players WHERE phone = $1`, [normalized])
    if (player.rows.length === 0) {
      throw new AppError('PLAYER_NOT_FOUND', 'No user found with that phone number.', 404)
    }
    const playerId = player.rows[0].id

    await creditDeposit(client, playerId, Number(rows[0].amount), `c2b-repost:${rows[0].mpesa_receipt}`, {
      source: 'c2b_repost', mpesaReceipt: rows[0].mpesa_receipt, adminId,
    })
    await client.query(
      `UPDATE c2b_payments SET status = 'reposted', player_id = $2, resolved_by = $3, resolved_at = NOW() WHERE id = $1`,
      [id, playerId, adminId],
    )
    await client.query('COMMIT')
    credited = { playerId, amount: Number(rows[0].amount) }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  if (credited) await maybeGrantDepositMatch(credited.playerId, credited.amount)
}

/** Mark an unresolved payment as refunded (records the decision + audit). */
export async function refundC2bPayment(id: string, adminId: string, note?: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE c2b_payments
     SET status = 'refunded', resolved_by = $2, resolved_at = NOW(), note = $3
     WHERE id = $1 AND status = 'unresolved'`,
    [id, adminId, note ?? null],
  )
  if (rowCount === 0) {
    throw new AppError('ALREADY_RESOLVED', 'This payment is not awaiting resolution.', 422)
  }
}
