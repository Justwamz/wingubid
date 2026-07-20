import type { FastifyInstance } from 'fastify'
import { getHouseEdges } from '../../services/game-settings.service.js'

// Public game config so the client can display odds that match server payouts
// (e.g. the dice multiplier is derived from the configured house edge).
export async function gameConfigRoutes(app: FastifyInstance) {
  app.get('/games/config', async (_req, reply) => {
    return reply.send({ houseEdge: await getHouseEdges() })
  })
}
