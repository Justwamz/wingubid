import type { FastifyInstance } from 'fastify'
import { refreshPlayerTokens, AppError } from '../../services/auth.service.js'

export async function refreshRoutes(app: FastifyInstance) {
  app.post('/auth/refresh', async (req, reply) => {
    const refreshToken = req.cookies?.refresh_token
    if (!refreshToken) {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'No refresh token' } })
    }

    try {
      const { accessToken, refreshToken: newRefreshToken } = await refreshPlayerTokens(refreshToken)

      reply.setCookie('refresh_token', newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        path: '/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      })

      return reply.send({ access_token: accessToken })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })
}
