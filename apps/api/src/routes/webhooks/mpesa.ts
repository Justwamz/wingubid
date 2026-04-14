import type { FastifyInstance } from 'fastify'
import { confirmDeposit, confirmWithdrawal } from '../../services/payment.service.js'

interface MpesaCallback {
  Body: {
    stkCallback: {
      MerchantRequestID: string
      CheckoutRequestID: string
      ResultCode: number
      ResultDesc: string
    }
  }
}

export async function mpesaWebhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/mpesa', async (req, reply) => {
    try {
      const body = req.body as MpesaCallback
      const { CheckoutRequestID, ResultCode, ResultDesc } = body.Body.stkCallback
      const success = ResultCode === 0
      await confirmDeposit(CheckoutRequestID, success, success ? undefined : ResultDesc)
    } catch (err) {
      app.log.error(err, 'mpesa webhook error')
    }
    return reply.status(200).send({ ResultCode: 0, ResultDesc: 'Accepted' })
  })
}
