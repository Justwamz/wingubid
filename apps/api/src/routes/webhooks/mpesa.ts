import type { FastifyInstance } from 'fastify'
import { confirmDeposit, confirmWithdrawal } from '../../services/payment.service.js'
import { authenticatePaymentWebhook } from '../../middleware/authenticate-payment-webhook.js'

interface MpesaCallback {
  Body: {
    stkCallback: {
      MerchantRequestID: string
      CheckoutRequestID: string
      ResultCode: number
      ResultDesc: string
      CallbackMetadata?: {
        Item: { Name: string; Value: string | number }[]
      }
    }
  }
}

export async function mpesaWebhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/mpesa', { preHandler: authenticatePaymentWebhook }, async (req, reply) => {
    try {
      const body = req.body as MpesaCallback
      const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = body.Body.stkCallback
      const success = ResultCode === 0
      // Safaricom sends the paid Amount in major units (KES); we store cents.
      const amountItem = CallbackMetadata?.Item?.find(i => i.Name === 'Amount')
      const confirmed = amountItem != null
        ? { amount: Math.round(Number(amountItem.Value) * 100) }
        : undefined
      await confirmDeposit(CheckoutRequestID, success, success ? undefined : ResultDesc, confirmed)
    } catch (err) {
      app.log.error(err, 'mpesa webhook error')
    }
    return reply.status(200).send({ ResultCode: 0, ResultDesc: 'Accepted' })
  })
}
