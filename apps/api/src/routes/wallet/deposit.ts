import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { initiateDeposit } from '../../services/payment.service.js'
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

export async function walletDepositRoutes(app: FastifyInstance) {
  app.post('/wallet/deposit', { preHandler: authenticate }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    try {
      const result = await initiateDeposit(req.playerId, parsed.data.amount, parsed.data.provider)
      return reply.status(202).send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // Demo top-up — only available when DEMO_MODE is explicitly enabled
  app.post('/wallet/demo-topup', { preHandler: authenticate }, async (req, reply) => {
    if (!env.DEMO_MODE) {
      return reply.status(403).send({ error: { code: 'NOT_AVAILABLE', message: 'Demo top-up is disabled' } })
    }

    const parsed = demoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    const { rows } = await pool.query<{ id: string; balance: number }>(
      `UPDATE wallets SET balance = balance + $1 WHERE player_id = $2 RETURNING id, balance`,
      [parsed.data.amount, req.playerId],
    )
    if (rows.length === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Wallet not found' } })
    }

    return reply.send({ balance: rows[0].balance, added: parsed.data.amount })
  })
}
