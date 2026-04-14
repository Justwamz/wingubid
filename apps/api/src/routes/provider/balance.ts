import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticateProvider } from '../../middleware/authenticate-provider.js'
import { getWalletBalance } from '../../services/wallet.service.js'
import { AppError } from '../../lib/errors.js'

const query = z.object({
  playerId: z.string().uuid(),
})

export async function providerBalanceRoutes(app: FastifyInstance) {
  app.get('/provider/balance', { preHandler: authenticateProvider }, async (req, reply) => {
    const parsed = query.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    try {
      const wallet = await getWalletBalance(parsed.data.playerId)
      return reply.send({ balance: wallet.balance, currency: wallet.currency })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })
}
