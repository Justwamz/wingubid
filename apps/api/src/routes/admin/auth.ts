import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { loginAdmin, logoutAdmin } from '../../services/admin-auth.service.js'
import { AppError } from '../../services/auth.service.js'

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function adminAuthRoutes(app: FastifyInstance) {
  app.post('/admin/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = loginBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    try {
      const { accessToken, refreshToken, admin, mustChangePassword } = await loginAdmin(
        parsed.data.email,
        parsed.data.password,
      )

      reply.setCookie('admin_refresh_token', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/admin/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      })

      return reply.send({ access_token: accessToken, admin, mustChangePassword })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  app.post('/admin/auth/logout', async (req, reply) => {
    const refreshToken = req.cookies?.admin_refresh_token
    if (refreshToken) {
      await logoutAdmin(refreshToken)
    }
    reply.clearCookie('admin_refresh_token', { path: '/admin/auth/refresh' })
    return reply.status(204).send()
  })
}
