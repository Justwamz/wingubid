import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { confirmDeposit, confirmWithdrawal } from '../../services/payment.service.js'

const body = z.object({
  transactionId: z.string().uuid(),
  success: z.boolean().default(true),
  failureReason: z.string().optional(),
})

export async function stubWebhookRoutes(app: FastifyInstance) {
  if (process.env.NODE_ENV === 'production') return

  app.post('/webhooks/stub/complete', async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    const { transactionId, success, failureReason } = parsed.data

    const { rows } = await pool.query<{ type: string; provider_ref: string; status: string }>(
      `SELECT type, provider_ref, status FROM payment_transactions WHERE id = $1`,
      [transactionId],
    )

    if (rows.length === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Transaction not found' } })
    }

    const pt = rows[0]

    if (pt.status === 'completed' || pt.status === 'failed') {
      return reply.send({ message: `Already ${pt.status}` })
    }

    if (!pt.provider_ref) {
      return reply.status(400).send({ error: { code: 'NO_PROVIDER_REF', message: 'No provider_ref yet' } })
    }

    if (pt.type === 'deposit') {
      await confirmDeposit(pt.provider_ref, success, failureReason)
    } else {
      await confirmWithdrawal(pt.provider_ref, success, failureReason)
    }

    return reply.send({ message: success ? 'confirmed' : 'failed', transactionId })
  })
}
