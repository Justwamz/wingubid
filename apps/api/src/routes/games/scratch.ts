import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { buyScratchCard, getScratchHistory } from '../../services/scratch.service.js'
import { AppError } from '../../lib/errors.js'

const buyBody = z.object({
  stake: z.number().int().positive(),
})

export async function scratchRoutes(app: FastifyInstance) {
  app.post('/games/scratch/buy', { preHandler: authenticate }, async (req, reply) => {
    const parsed = buyBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }
    try {
      const result = await buyScratchCard(req.playerId, parsed.data.stake)
      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  app.get('/games/scratch/history', { preHandler: authenticate }, async (req, reply) => {
    const history = await getScratchHistory(req.playerId)
    return reply.send({ cards: history })
  })
}
