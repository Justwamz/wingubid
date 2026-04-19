import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import {
  getUpcomingDraws,
  buyTicket,
  getPlayerTickets,
} from '../../services/lottery.service.js'
import { AppError } from '../../lib/errors.js'

const buyBody = z.object({
  drawType: z.enum(['hourly', 'daily', 'weekly']),
  pickedNumbers: z.array(z.number().int().min(1).max(36)).length(3),
})

export async function lotteryRoutes(app: FastifyInstance) {
  app.get('/games/lottery/draws', { preHandler: authenticate }, async (_req, reply) => {
    const draws = await getUpcomingDraws()
    return reply.send({ draws })
  })

  app.post('/games/lottery/tickets', { preHandler: authenticate }, async (req, reply) => {
    const parsed = buyBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }
    try {
      const result = await buyTicket(
        req.playerId,
        parsed.data.drawType,
        parsed.data.pickedNumbers,
      )
      return reply.status(201).send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  app.get('/games/lottery/tickets/mine', { preHandler: authenticate }, async (req, reply) => {
    const tickets = await getPlayerTickets(req.playerId)
    return reply.send({ tickets })
  })
}
