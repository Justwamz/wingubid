import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { loginPlayer, AppError } from '../../services/auth.service.js'
import { normalizeKePhone } from '../../lib/phone.js'

const body = z.object({
  // Normalize the format so it matches the stored +254 number regardless of how
  // it was typed (login doesn't enforce the Safaricom prefix - that's registration).
  phone: z.string({ required_error: 'Please enter your phone number.' }).min(1, 'Please enter your phone number.').transform(s => normalizeKePhone(s) ?? s),
  password: z.string({ required_error: 'Please enter your password.' }).min(1, 'Please enter your password.'),
})

export async function loginRoutes(app: FastifyInstance) {
  app.post('/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    try {
      const { accessToken, refreshToken } = await loginPlayer(
        parsed.data.phone,
        parsed.data.password,
      )

      reply.setCookie('refresh_token', refreshToken, {
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
