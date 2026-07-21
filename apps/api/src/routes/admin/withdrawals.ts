import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { pool } from '@betting/db'
import { approveWithdrawal, rejectWithdrawal } from '../../services/payment.service.js'
import { getWithdrawalThreshold, setWithdrawalThreshold } from '../../services/game-settings.service.js'
import { AppError } from '../../lib/errors.js'

export async function adminWithdrawalRoutes(app: FastifyInstance) {
  // List all withdrawals with player info
  app.get('/admin/withdrawals', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const { rows } = await pool.query<{
      id: string
      player_name: string
      phone: string
      amount: number
      status: string
      provider: string
      created_at: string
      updated_at: string | null
    }>(
      `SELECT
         pt.id,
         p.name  AS player_name,
         p.phone,
         pt.amount,
         pt.status,
         pt.provider,
         pt.created_at,
         pt.updated_at
       FROM payment_transactions pt
       JOIN players p ON p.id = pt.player_id
       WHERE pt.type = 'withdrawal'
       ORDER BY pt.created_at DESC
       LIMIT 200`,
    )
    return reply.send({ withdrawals: rows })
  })

  // Maker-checker approval threshold (cents).
  app.get('/admin/withdrawal-config', { preHandler: authenticateAdmin }, async (_req, reply) => {
    return reply.send({ approvalThreshold: await getWithdrawalThreshold() })
  })

  app.put('/admin/withdrawal-config', { preHandler: [authenticateAdmin, requirePermission('withdrawals.config')] }, async (req, reply) => {
    const parsed = z.object({
      approvalThreshold: z.number().int().min(0, 'Threshold cannot be negative.'),
    }).safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    await setWithdrawalThreshold(parsed.data.approvalThreshold)
    return reply.send({ approvalThreshold: parsed.data.approvalThreshold })
  })

  // Approve an above-threshold withdrawal (finance/super_admin only).
  app.post('/admin/withdrawals/:id/approve', { preHandler: [authenticateAdmin, requirePermission('withdrawals.approve')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      await approveWithdrawal(id, req.adminId)
      return reply.send({ ok: true })
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // Reject an above-threshold withdrawal and return the funds (finance/super_admin only).
  app.post('/admin/withdrawals/:id/reject', { preHandler: [authenticateAdmin, requirePermission('withdrawals.reject')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({ reason: z.string().max(500).optional() }).safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    try {
      await rejectWithdrawal(id, req.adminId, parsed.data.reason)
      return reply.send({ ok: true })
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // Retry a failed withdrawal (simulated: mark as completed and refund nothing)
  app.post('/admin/withdrawals/:id/retry', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const { rows } = await pool.query<{
      id: string; player_id: string; wallet_id: string; amount: number; status: string
    }>(
      `SELECT id, player_id, wallet_id, amount, status FROM payment_transactions WHERE id = $1 AND type = 'withdrawal'`,
      [id],
    )

    if (rows.length === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Withdrawal not found' } })
    }

    const pt = rows[0]
    if (pt.status !== 'failed') {
      return reply.status(422).send({ error: { code: 'INVALID_STATE', message: `Cannot retry a withdrawal with status '${pt.status}'` } })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Re-read and lock the withdrawal row; only proceed if it is still
      // 'failed'. This makes concurrent/duplicate retries idempotent - the
      // loser sees a non-failed status and is rejected instead of double-debiting.
      const { rows: locked } = await client.query<{
        status: string; amount: number; player_id: string; wallet_id: string
      }>(
        `SELECT status, amount, player_id, wallet_id FROM payment_transactions
         WHERE id = $1 AND type = 'withdrawal' FOR UPDATE`,
        [pt.id],
      )
      if (locked.length === 0 || locked[0].status !== 'failed') {
        await client.query('ROLLBACK')
        return reply.status(422).send({ error: { code: 'INVALID_STATE', message: 'Withdrawal is not in a retryable state' } })
      }
      const amount = Number(locked[0].amount)

      // Lock the wallet and check funds. The balance was refunded when the
      // withdrawal failed, so retrying debits it again - but the player may have
      // since spent it, so verify sufficiency and return a clean error.
      const { rows: wrows } = await client.query<{ balance: number }>(
        `SELECT balance FROM wallets WHERE player_id = $1 FOR UPDATE`,
        [locked[0].player_id],
      )
      if (wrows.length === 0) {
        await client.query('ROLLBACK')
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Wallet not found' } })
      }
      if (Number(wrows[0].balance) < amount) {
        await client.query('ROLLBACK')
        return reply.status(422).send({ error: { code: 'INSUFFICIENT_FUNDS', message: 'Player balance is insufficient to retry this withdrawal' } })
      }

      await client.query(
        `UPDATE payment_transactions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [pt.id],
      )
      const { rows: updated } = await client.query<{ balance: number }>(
        `UPDATE wallets SET balance = balance - $1 WHERE player_id = $2 RETURNING balance`,
        [amount, locked[0].player_id],
      )
      await client.query(
        `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
         VALUES ($1, $2, 'withdrawal', $3, $4, 'completed', '{"admin_retry":true}')`,
        [locked[0].wallet_id, locked[0].player_id, amount, Number(updated[0].balance)],
      )

      await client.query('COMMIT')
      return reply.send({ success: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })
}
