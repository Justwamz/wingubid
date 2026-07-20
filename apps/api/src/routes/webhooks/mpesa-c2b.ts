import { z } from 'zod'
import { randomBytes } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { authenticatePaymentWebhook } from '../../middleware/authenticate-payment-webhook.js'
import { recordC2bPayment } from '../../services/c2b.service.js'
import { env } from '../../env.js'

// Safaricom C2B confirmation payload (subset we use). Amounts arrive in major
// KES (e.g. "500.00"); we store cents. MSISDN arrives as 2547........
const confirmationBody = z.object({
  TransID: z.string().min(1),
  TransAmount: z.union([z.string(), z.number()]),
  MSISDN: z.union([z.string(), z.number()]),
})

export async function mpesaC2bRoutes(app: FastifyInstance) {
  // Real Safaricom C2B confirmation URL. Requires Daraja C2B URL registration
  // and the shared-secret guard to go live (see authenticate-payment-webhook).
  app.post('/webhooks/mpesa/c2b', { preHandler: authenticatePaymentWebhook }, async (req, reply) => {
    const parsed = confirmationBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    const amountCents = Math.round(Number(parsed.data.TransAmount) * 100)
    await recordC2bPayment({
      msisdn: String(parsed.data.MSISDN),
      amount: amountCents,
      mpesaReceipt: parsed.data.TransID,
    })
    // Safaricom expects this acknowledgement shape.
    return reply.send({ ResultCode: 0, ResultDesc: 'Accepted' })
  })

  // Demo trigger to exercise the C2B match/suspense/reconcile flow without
  // Safaricom. Amount is in cents (like demo-topup); receipt auto-generated.
  app.post('/webhooks/demo/c2b', async (req, reply) => {
    if (!env.DEMO_MODE) {
      return reply.status(403).send({ error: { code: 'NOT_AVAILABLE', message: 'Demo C2B is disabled' } })
    }
    const parsed = z.object({
      msisdn: z.string().min(1),
      amount: z.number().int().positive(),
      mpesaReceipt: z.string().min(1).optional(),
    }).safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    const receipt = parsed.data.mpesaReceipt ?? `DEMO${randomBytes(5).toString('hex').toUpperCase()}`
    const result = await recordC2bPayment({
      msisdn: parsed.data.msisdn,
      amount: parsed.data.amount,
      mpesaReceipt: receipt,
    })
    return reply.send({ ...result, mpesaReceipt: receipt })
  })
}
