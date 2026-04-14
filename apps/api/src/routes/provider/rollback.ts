import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateProvider } from '../../middleware/authenticate-provider.js'
import { refundBet } from '../../services/wallet.service.js'
import { AppError } from '../../lib/errors.js'

const body = z.object({
  playerId: z.string().uuid(),
  originalTransactionRef: z.string(),
  transactionRef: z.string(),
})

export async function providerRollbackRoutes(app: FastifyInstance) {
  app.post('/provider/rollback', { preHandler: authenticateProvider }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    const { playerId, originalTransactionRef, transactionRef } = parsed.data

    // Idempotency on rollback transactionRef
    const { rows: existingRollback } = await pool.query<{ balance_after: number; id: string }>(
      `SELECT id, balance_after FROM transactions WHERE idempotency_key = $1`,
      [transactionRef],
    )
    if (existingRollback.length > 0) {
      return reply.send({
        balance: Number(existingRollback[0].balance_after),
        transactionId: existingRollback[0].id,
      })
    }

    // Find original transaction
    const { rows: origRows } = await pool.query<{ id: string; amount: number }>(
      `SELECT id, amount FROM transactions WHERE idempotency_key = $1`,
      [originalTransactionRef],
    )
    if (origRows.length === 0) {
      return reply.status(404).send({
        error: { code: 'TRANSACTION_NOT_FOUND', message: 'Original transaction not found' },
      })
    }

    const { amount } = origRows[0]

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { transactionId } = await refundBet(
        client, playerId, Number(amount),
        { originalTransactionRef, provider: req.providerId },
      )

      await client.query(
        `UPDATE transactions SET idempotency_key = $1 WHERE id = $2`,
        [transactionRef, transactionId],
      )

      const { rows: wRows } = await client.query<{ balance: string }>(
        `SELECT balance FROM wallets WHERE player_id = $1`,
        [playerId],
      )

      await client.query('COMMIT')
      return reply.send({ balance: Number(wRows[0].balance), transactionId })
    } catch (err) {
      await client.query('ROLLBACK')
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    } finally {
      client.release()
    }
  })
}
