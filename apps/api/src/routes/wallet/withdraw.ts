import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { initiateWithdrawal } from '../../services/payment.service.js'
import { AppError } from '../../lib/errors.js'
import { env } from '../../env.js'
import { pool } from '@betting/db'

const body = z.object({
  amount: z.number().int().positive(),
  provider: z.enum(['mpesa', 'mtn', 'airtel']),
})

const demoBody = z.object({
  amount: z.number().int().positive(),
})

const MIN_WITHDRAWAL = 10000 // KES 100 in cents

export async function walletWithdrawRoutes(app: FastifyInstance) {
  // Real withdrawal — calls payment provider (production)
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

  // Demo withdrawal — only available when SMS_ENABLED=false (demo mode)
  app.post('/wallet/demo-withdraw', { preHandler: authenticate }, async (req, reply) => {
    if (env.SMS_ENABLED) {
      return reply.status(403).send({ error: { code: 'NOT_AVAILABLE', message: 'Demo withdrawal not available in production' } })
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

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { rows: walletRows } = await client.query<{ id: string; balance: number }>(
        `SELECT id, balance FROM wallets WHERE player_id = $1 FOR UPDATE`,
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

      const { rows: updated } = await client.query<{ balance: number }>(
        `UPDATE wallets SET balance = balance - $1 WHERE player_id = $2 RETURNING balance`,
        [amount, req.playerId],
      )
      const newBalance = Number(updated[0].balance)

      // Record in payment_transactions for admin tracking
      const { rows: ptRows } = await client.query<{ id: string }>(
        `INSERT INTO payment_transactions
           (player_id, wallet_id, type, provider, amount, currency, idempotency_key, status)
         VALUES ($1, $2, 'withdrawal', 'mpesa', $3,
                 (SELECT currency FROM wallets WHERE id = $2),
                 $4, 'completed')
         RETURNING id`,
        [req.playerId, wallet.id, amount, `demo-withdraw:${req.playerId}:${Date.now()}`],
      )

      // Ledger entry
      await client.query(
        `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
         VALUES ($1, $2, 'withdrawal', $3, $4, 'completed', '{"demo":true}')`,
        [wallet.id, req.playerId, amount, newBalance],
      )

      await client.query('COMMIT')
      return reply.send({ balance: newBalance, withdrawn: amount })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
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
