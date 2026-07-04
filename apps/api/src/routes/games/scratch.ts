import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { buyScratchCard, getScratchHistory } from '../../services/scratch.service.js'
import { getScratchCommitment, rotateScratchSeed } from '../../services/scratch-seed.service.js'
import { AppError } from '../../lib/errors.js'

const buyBody = z.object({
  stake: z.number().int().positive(),
})

const rotateBody = z.object({
  clientSeed: z.string().min(1).max(256).optional(),
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

  // Current provably-fair commitment (server seed hash + client seed + nonce).
  app.get('/games/scratch/seed', { preHandler: authenticate }, async (req, reply) => {
    return reply.send(await getScratchCommitment(req.playerId))
  })

  // Rotate the seed: reveals the retired server seed for verification and
  // commits a fresh one; the player may supply their own client seed.
  app.post('/games/scratch/seed/rotate', { preHandler: authenticate }, async (req, reply) => {
    const parsed = rotateBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    return reply.send(await rotateScratchSeed(req.playerId, parsed.data.clientSeed))
  })
}
