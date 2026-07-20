import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { initiateWithdrawal } from '../../services/payment.service.js'
import { getWithdrawalThreshold } from '../../services/game-settings.service.js'
import { notifyWithdrawal } from '../../services/email.service.js'
import { AppError } from '../../lib/errors.js'
import { env } from '../../env.js'
import { pool } from '@betting/db'

const body = z.object({
  amount: z.number({ invalid_type_error: 'Please enter a valid amount.' }).int('Please enter a valid amount.').positive('Please enter an amount greater than zero.'),
  provider: z.enum(['mpesa', 'mtn', 'airtel'], { errorMap: () => ({ message: 'Please choose a payment method.' }) }),
})

const demoBody = z.object({
  amount: z.number({ invalid_type_error: 'Please enter a valid amount.' }).int('Please enter a valid amount.').positive('Please enter an amount greater than zero.'),
})

const MIN_WITHDRAWAL = 10000 // KES 100 in cents

export async function walletWithdrawRoutes(app: FastifyInstance) {
  // Real withdrawal - calls payment provider (production)
  app.post('/wallet/withdraw', { preHandler: authenticate }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    try {
      const result = await initiateWithdrawal(req.playerId, parsed.data.amount, parsed.data.provider)
      return reply.status(202).send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // Demo withdrawal - only available when DEMO_MODE is explicitly enabled
  app.post('/wallet/demo-withdraw', { preHandler: authenticate }, async (req, reply) => {
    if (!env.DEMO_MODE) {
      return reply.status(403).send({ error: { code: 'NOT_AVAILABLE', message: 'Demo withdrawal is disabled' } })
    }

    const parsed = demoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    const { amount } = parsed.data
    if (amount < MIN_WITHDRAWAL) {
      return reply.status(422).send({
        error: { code: 'LIMIT_EXCEEDED', message: `Minimum withdrawal is KES ${MIN_WITHDRAWAL / 100}` },
      })
    }

    const threshold = await getWithdrawalThreshold()
    const needsApproval = amount > threshold

    const client = await pool.connect()
    let notify: { id: string; amount: number; phone: string; player: string; provider: string } | null = null
    let responseBody: { status: string; balance: number; withdrawn?: number }
    try {
      await client.query('BEGIN')

      const { rows: walletRows } = await client.query<{ id: string; balance: number; currency: string }>(
        `SELECT w.id, w.balance, w.currency FROM wallets w WHERE w.player_id = $1 FOR UPDATE`,
        [req.playerId],
      )
      if (walletRows.length === 0) {
        await client.query('ROLLBACK')
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Wallet not found' } })
      }

      const wallet = walletRows[0]
      if (Number(wallet.balance) < amount) {
        await client.query('ROLLBACK')
        return reply.status(422).send({ error: { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient balance' } })
      }

      const { rows: prow } = await client.query<{ name: string; phone: string }>(
        `SELECT name, phone FROM players WHERE id = $1`, [req.playerId],
      )

      if (needsApproval) {
        // Maker-checker: lock the funds and hold for an admin decision.
        const { rows: updated } = await client.query<{ balance: number }>(
          `UPDATE wallets SET balance = balance - $1, locked_balance = locked_balance + $1 WHERE player_id = $2 RETURNING balance`,
          [amount, req.playerId],
        )
        const { rows: ptRows } = await client.query<{ id: string }>(
          `INSERT INTO payment_transactions
             (player_id, wallet_id, type, provider, amount, currency, idempotency_key, status, net_amount, tax_amount)
           VALUES ($1, $2, 'withdrawal', 'mpesa', $3, $4, $5, 'awaiting_approval', $3, 0)
           RETURNING id`,
          [req.playerId, wallet.id, amount, wallet.currency, `demo-withdraw:${req.playerId}:${Date.now()}`],
        )
        await client.query('COMMIT')
        notify = { id: ptRows[0].id, amount, phone: prow[0].phone, player: prow[0].name, provider: 'mpesa' }
        responseBody = { status: 'awaiting_approval', balance: Number(updated[0].balance) }
      } else {
        const { rows: updated } = await client.query<{ balance: number }>(
          `UPDATE wallets SET balance = balance - $1 WHERE player_id = $2 RETURNING balance`,
          [amount, req.playerId],
        )
        const newBalance = Number(updated[0].balance)
        const { rows: ptRows } = await client.query<{ id: string }>(
          `INSERT INTO payment_transactions
             (player_id, wallet_id, type, provider, amount, currency, idempotency_key, status)
           VALUES ($1, $2, 'withdrawal', 'mpesa', $3, $4, $5, 'completed')
           RETURNING id`,
          [req.playerId, wallet.id, amount, wallet.currency, `demo-withdraw:${req.playerId}:${Date.now()}`],
        )
        await client.query(
          `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
           VALUES ($1, $2, 'withdrawal', $3, $4, 'completed', '{"demo":true}')`,
          [wallet.id, req.playerId, amount, newBalance],
        )
        await client.query('COMMIT')
        notify = { id: ptRows[0].id, amount, phone: prow[0].phone, player: prow[0].name, provider: 'mpesa' }
        responseBody = { status: 'completed', balance: newBalance, withdrawn: amount }
      }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    if (notify) await notifyWithdrawal(needsApproval ? 'needs_approval' : 'initiated', notify)
    return reply.send(responseBody)
  })

  // Recent withdrawals for the logged-in player
  app.get('/wallet/withdrawals', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await pool.query<{
      id: string; amount: number; status: string; created_at: string
    }>(
      `SELECT id, amount, status, created_at
       FROM payment_transactions
       WHERE player_id = $1 AND type = 'withdrawal'
       ORDER BY created_at DESC LIMIT 20`,
      [req.playerId],
    )
    return reply.send({ withdrawals: rows })
  })
}
