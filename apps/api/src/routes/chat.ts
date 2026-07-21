import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../middleware/authenticate.js'
import { getUsername, setUsername } from '../services/chat.service.js'
import { AppError } from '../lib/errors.js'

export async function chatRoutes(app: FastifyInstance) {
  app.get('/chat/me', { preHandler: authenticate }, async (req, reply) => {
    return reply.send({ username: await getUsername(req.playerId) })
  })

  app.post('/chat/username', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ username: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Enter a username.' } })
    }
    try {
      const username = await setUsername(req.playerId, parsed.data.username)
      return reply.send({ username })
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })
}
