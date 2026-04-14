import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { getWalletBalance } from '../../services/wallet.service.js'
import { AppError } from '../../lib/errors.js'

export async function walletBalanceRoutes(app: FastifyInstance) {
  app.get('/wallet/balance', { preHandler: authenticate }, async (req, reply) => {
    try {
      const wallet = await getWalletBalance(req.playerId)
      return reply.send({
        balance: wallet.balance,
        bonus_balance: wallet.bonusBalance,
        locked_balance: wallet.lockedBalance,
        currency: wallet.currency,
      })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })
}
