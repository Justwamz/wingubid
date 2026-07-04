import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { rollDice } from '../../services/dice.service.js'
import { getDiceCommitment, rotateDiceSeed } from '../../services/dice-seed.service.js'
import { AppError } from '../../lib/errors.js'

const body = z.object({
  grossStake: z.number().int().positive(),
  target: z.number().int().min(1).max(98),
  direction: z.enum(['over', 'under']),
})

const rotateBody = z.object({
  clientSeed: z.string().min(1).max(256).optional(),
})

export async function diceRoutes(app: FastifyInstance) {
  app.post('/games/dice/roll', { preHandler: authenticate }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    try {
      const { grossStake, target, direction } = parsed.data
      return reply.send(await rollDice(req.playerId, grossStake, target, direction))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // Current provably-fair commitment: the server seed hash + client seed the
  // next rolls will use, and the current nonce. The raw server seed stays secret.
  app.get('/games/dice/seed', { preHandler: authenticate }, async (req, reply) => {
    return reply.send(await getDiceCommitment(req.playerId))
  })

  // Rotate the seed: reveals the retired server seed (so the player can verify
  // every past roll) and commits a fresh one. Player may supply a client seed.
  app.post('/games/dice/seed/rotate', { preHandler: authenticate }, async (req, reply) => {
    const parsed = rotateBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    return reply.send(await rotateDiceSeed(req.playerId, parsed.data.clientSeed))
  })
}
