import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { listC2bPayments, repostC2bPayment, refundC2bPayment } from '../../services/c2b.service.js'
import { AppError } from '../../lib/errors.js'

export async function adminC2bRoutes(app: FastifyInstance) {
  app.get('/admin/c2b-payments', { preHandler: authenticateAdmin }, async (_req, reply) => {
    return reply.send(await listC2bPayments())
  })

  app.post('/admin/c2b-payments/:id/repost', { preHandler: authenticateAdmin }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params)
    const body = z.object({ phone: z.string().min(1, 'Enter the user\'s phone number.') }).safeParse(req.body)
    if (!params.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid payment id.' } })
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: body.error.issues[0].message } })
    try {
      await repostC2bPayment(params.data.id, body.data.phone, req.adminId)
      return reply.send({ ok: true })
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  app.post('/admin/c2b-payments/:id/refund', { preHandler: authenticateAdmin }, async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params)
    const body = z.object({ note: z.string().max(500).optional() }).safeParse(req.body ?? {})
    if (!params.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid payment id.' } })
    if (!body.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: body.error.issues[0].message } })
    try {
      await refundC2bPayment(params.data.id, req.adminId, body.data.note)
      return reply.send({ ok: true })
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })
}
