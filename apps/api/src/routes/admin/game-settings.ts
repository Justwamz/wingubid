import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { getHouseEdges, setHouseEdge } from '../../services/game-settings.service.js'

// House edge is a percentage; bound it to a sane range so a typo can't make a
// game unplayable or run at a loss.
const edge = z.number().min(0, 'House edge cannot be negative.').max(30, 'House edge cannot exceed 30%.')
const bodySchema = z.object({ crash: edge, mines: edge, dice: edge })

export async function adminGameSettingsRoutes(app: FastifyInstance) {
  app.get('/admin/game-settings', { preHandler: authenticateAdmin }, async (_req, reply) => {
    return reply.send({ houseEdge: await getHouseEdges() })
  })

  app.put('/admin/game-settings', { preHandler: authenticateAdmin }, async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    await setHouseEdge('crash', parsed.data.crash)
    await setHouseEdge('mines', parsed.data.mines)
    await setHouseEdge('dice', parsed.data.dice)
    return reply.send({ houseEdge: await getHouseEdges() })
  })
}
