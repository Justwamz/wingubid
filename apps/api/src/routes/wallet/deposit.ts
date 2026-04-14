import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { initiateDeposit } from '../../services/payment.service.js'
import { AppError } from '../../lib/errors.js'

const body = z.object({
  amount: z.number().int().positive(),
  provider: z.enum(['mpesa', 'mtn', 'airtel']),
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
}
