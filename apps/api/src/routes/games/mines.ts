import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { startGame, revealTile, cashoutMines, getCurrentGame } from '../../services/mines.service.js'
import { AppError } from '../../lib/errors.js'

export async function minesRoutes(app: FastifyInstance) {
  // Resume support: returns the player's in-progress game (or { game: null }).
  app.get('/games/mines/current', { preHandler: authenticate }, async (req, reply) => {
    return reply.send({ game: await getCurrentGame(req.playerId) })
  })

  app.post('/games/mines/start', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({
      grossStake: z.number({ invalid_type_error: 'Please enter a valid bet amount.' }).int('Please enter a valid bet amount.').positive('Please enter a bet greater than zero.'),
      gridSize: z.number().int().min(3, 'Please choose a valid grid size.').max(5, 'Please choose a valid grid size.'),
      mineCount: z.number().int().min(1, 'Please choose a valid number of mines.'),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    try {
      return reply.status(201).send(await startGame(req.playerId, parsed.data.grossStake, parsed.data.gridSize, parsed.data.mineCount))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  app.post('/games/mines/reveal', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ gameId: z.string().min(1), tileIndex: z.number().int().min(0) }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    try {
      return reply.send(await revealTile(req.playerId, parsed.data.gameId, parsed.data.tileIndex))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  app.post('/games/mines/cashout', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ gameId: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    try {
      return reply.send(await cashoutMines(req.playerId, parsed.data.gameId))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })
}
