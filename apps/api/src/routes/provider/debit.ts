import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateProvider } from '../../middleware/authenticate-provider.js'
import { debitForBet } from '../../services/wallet.service.js'
import { calculateTax, recordTax } from '../../services/tax.service.js'
import { AppError } from '../../lib/errors.js'

const body = z.object({
  playerId: z.string().uuid(),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  roundId: z.string(),
  gameId: z.string(),
  transactionRef: z.string(),
})

export async function providerDebitRoutes(app: FastifyInstance) {
  app.post('/provider/debit', { preHandler: authenticateProvider }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    const { playerId, amount, currency, roundId, gameId, transactionRef } = parsed.data

    // Idempotency check
    const { rows: existing } = await pool.query<{ id: string; balance_after: number }>(
      `SELECT id, balance_after FROM transactions WHERE idempotency_key = $1`,
      [transactionRef],
    )
    if (existing.length > 0) {
      return reply.send({
        balance: Number(existing[0].balance_after),
        transactionId: existing[0].id,
      })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { rows: pRows } = await client.query<{ country: string }>(
        `SELECT country FROM players WHERE id = $1`,
        [playerId],
      )
      if (pRows.length === 0) throw new AppError('NOT_FOUND', 'Player not found', 404)
      const country = pRows[0].country

      const { taxAmount, effectiveAmount } = await calculateTax(country, 'wager_tax', amount)

      // Validate the provider's currency against the wallet before debiting.
      const { rows: cRows } = await client.query<{ currency: string }>(
        `SELECT currency FROM wallets WHERE player_id = $1`,
        [playerId],
      )
      if (cRows.length === 0) throw new AppError('NOT_FOUND', 'Wallet not found', 404)
      if (cRows[0].currency !== currency) {
        throw new AppError('CURRENCY_MISMATCH', `Currency ${currency} does not match wallet ${cRows[0].currency}`, 422)
      }

      // Provider settlement is external (credit/rollback are separate calls),
      // so this debit does not reserve locked_balance - there is no later
      // in-house settlement step to release it. The idempotency key is written
      // inside the INSERT so a concurrent duplicate hits the UNIQUE constraint.
      const { transactionId } = await debitForBet(
        client, playerId, amount, effectiveAmount,
        { roundId, gameId, provider: req.providerId, transactionRef },
        { lock: false, idempotencyKey: transactionRef },
      )

      if (taxAmount > 0) {
        await recordTax(client, { playerId, taxAmount, taxType: 'wager_tax', country, transactionId })
      }

      const { rows: wRows } = await client.query<{ balance: string }>(
        `SELECT balance FROM wallets WHERE player_id = $1`,
        [playerId],
      )

      await client.query('COMMIT')
      return reply.send({ balance: Number(wRows[0].balance), transactionId })
    } catch (err) {
      await client.query('ROLLBACK')
      // Lost a concurrent-duplicate race - return the winner's cached result.
      if ((err as { code?: string }).code === '23505') {
        const { rows } = await pool.query<{ id: string; balance_after: number }>(
          `SELECT id, balance_after FROM transactions WHERE idempotency_key = $1`,
          [transactionRef],
        )
        if (rows.length > 0) {
          return reply.send({ balance: Number(rows[0].balance_after), transactionId: rows[0].id })
        }
      }
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    } finally {
      client.release()
    }
  })
}
