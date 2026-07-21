import type { FastifyInstance } from 'fastify'
import { getHouseEdges, getGamesEnabled } from '../../services/game-settings.service.js'
import { getGameOrder } from '../../services/game-order.service.js'

// Public game config so the client can display odds that match server payouts
// (e.g. the dice multiplier is derived from the configured house edge), grey out
// any game an admin has paused, and order the lobby by the house-optimized rank.
export async function gameConfigRoutes(app: FastifyInstance) {
  app.get('/games/config', async (_req, reply) => {
    const [houseEdge, enabled, order] = await Promise.all([getHouseEdges(), getGamesEnabled(), getGameOrder()])
    return reply.send({ houseEdge, enabled, order })
  })
}
