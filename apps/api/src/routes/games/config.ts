import type { FastifyInstance } from 'fastify'
import { getHouseEdges, getGamesEnabled } from '../../services/game-settings.service.js'

// Public game config so the client can display odds that match server payouts
// (e.g. the dice multiplier is derived from the configured house edge) and grey
// out any game an admin has temporarily paused.
export async function gameConfigRoutes(app: FastifyInstance) {
  app.get('/games/config', async (_req, reply) => {
    const [houseEdge, enabled] = await Promise.all([getHouseEdges(), getGamesEnabled()])
    return reply.send({ houseEdge, enabled })
  })
}
