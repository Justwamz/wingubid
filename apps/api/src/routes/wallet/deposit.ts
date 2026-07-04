import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { initiateDeposit } from '../../services/payment.service.js'
import { creditDemoTopup } from '../../services/wallet.service.js'
import { AppError } from '../../lib/errors.js'
import { env } from '../../env.js'
import { pool } from '@betting/db'

const body = z.object({
  amount: z.number().int().positive(),
  provider: z.enum(['mpesa', 'mtn', 'airtel']),
})

const DEMO_TOPUP_MAX = 10_000_000 // KES 100,000 in cents
const demoBody = z.object({
  amount: z.number().int().positive().max(DEMO_TOPUP_MAX),
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

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { balance } = await creditDemoTopup(client, req.playerId, parsed.data.amount)
      await client.query('COMMIT')
      return reply.send({ balance, added: parsed.data.amount })
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
