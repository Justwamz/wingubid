import type { FastifyInstance } from 'fastify'
import { confirmDeposit, confirmWithdrawal } from '../../services/payment.service.js'
import { authenticatePaymentWebhook } from '../../middleware/authenticate-payment-webhook.js'

interface AirtelCallback {
  transaction: {
    id: string
    status: 'TS' | 'TF'
    message: string
    type: 'deposit' | 'withdrawal'
  }
}

export async function airtelWebhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/airtel', { preHandler: authenticatePaymentWebhook }, async (req, reply) => {
    try {
      const body = req.body as AirtelCallback
      const { id, status, message, type } = body.transaction
      const success = status === 'TS'
      if (type === 'deposit') {
        await confirmDeposit(id, success, success ? undefined : message)
      } else {
        await confirmWithdrawal(id, success, success ? undefined : message)
      }
    } catch (err) {
      app.log.error(err, 'airtel webhook error')
    }
    return reply.status(200).send()
  })
}
