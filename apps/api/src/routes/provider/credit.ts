import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateProvider } from '../../middleware/authenticate-provider.js'
import { creditWinnings } from '../../services/wallet.service.js'
import { AppError } from '../../lib/errors.js'

const body = z.object({
  playerId: z.string().uuid(),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  roundId: z.string(),
  gameId: z.string(),
  transactionRef: z.string(),
})

export async function providerCreditRoutes(app: FastifyInstance) {
  app.post('/provider/credit', { preHandler: authenticateProvider }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    const { playerId, amount, roundId, gameId, transactionRef } = parsed.data

    // Idempotency check
    const { rows: existing } = await pool.query<{ id: string; balance_after: number }>(
      `SELECT id, balance_after FROM transactions WHERE idempotency_key = $1`,
      [transactionRef],
    )
    if (existing.length > 0) {
      return reply.send({ balance: Number(existing[0].balance_after), transactionId: existing[0].id })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { transactionId } = await creditWinnings(
        client, playerId, amount,
        { roundId, gameId, provider: req.providerId, transactionRef },
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
