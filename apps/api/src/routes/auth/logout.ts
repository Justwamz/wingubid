import type { FastifyInstance } from 'fastify'
import { logoutPlayer } from '../../services/auth.service.js'

export async function logoutRoutes(app: FastifyInstance) {
  app.post('/auth/logout', async (req, reply) => {
    const refreshToken = req.cookies?.refresh_token
    if (refreshToken) {
      await logoutPlayer(refreshToken)
    }

    reply.clearCookie('refresh_token', { path: '/auth/refresh' })
    return reply.status(204).send()
  })
}
