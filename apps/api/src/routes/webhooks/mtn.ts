import type { FastifyInstance } from 'fastify'
import { confirmDeposit, confirmWithdrawal } from '../../services/payment.service.js'
import { authenticatePaymentWebhook } from '../../middleware/authenticate-payment-webhook.js'

interface MtnCallback {
  referenceId: string
  status: 'SUCCESSFUL' | 'FAILED'
  reason?: string
  type: 'deposit' | 'withdrawal'
}

export async function mtnWebhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/mtn', { preHandler: authenticatePaymentWebhook }, async (req, reply) => {
    try {
      const body = req.body as MtnCallback
      const success = body.status === 'SUCCESSFUL'
      if (body.type === 'deposit') {
        await confirmDeposit(body.referenceId, success, body.reason)
      } else {
        await confirmWithdrawal(body.referenceId, success, body.reason)
      }
    } catch (err) {
      app.log.error(err, 'mtn webhook error')
    }
    return reply.status(200).send()
  })
}
