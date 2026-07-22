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
  drawType: z.enum(['hourly', 'daily', 'weekly'], { errorMap: () => ({ message: 'Please choose a lottery draw.' }) }),
  pickedNumbers: z.array(z.number().int().min(1, 'Your numbers must be between 1 and 36.').max(36, 'Your numbers must be between 1 and 36.'), { invalid_type_error: 'Please pick your numbers.' }).length(3, 'Please pick exactly 3 numbers.'),
})

export async function lotteryRoutes(app: FastifyInstance) {
  app.get('/games/lottery/draws', { preHandler: authenticate }, async (_req, reply) => {
    const draws = await getUpcomingDraws()
    return reply.send({ draws })
  })

  app.post('/games/lottery/tickets', { preHandler: authenticate }, async (req, reply) => {
    if ((req.body as { fundSource?: string })?.fundSource === 'bonus') {
      return reply.status(422).send({ error: { code: 'BONUS_NOT_ALLOWED', message: 'Bonus funds cannot be used on Wingu Lotto.' } })
    }
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
