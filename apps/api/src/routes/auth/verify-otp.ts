import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { verifyPlayerOtp, AppError } from '../../services/auth.service.js'

const body = z.object({
  phone: z.string({ required_error: 'Please enter your phone number.' }).regex(/^\+\d{9,15}$/, 'Please enter your phone number.'),
  code: z.string({ required_error: 'Enter the 6-digit verification code we sent you.' }).regex(/^\d{6}$/, 'Enter the 6-digit verification code we sent you.'),
})

export async function verifyOtpRoutes(app: FastifyInstance) {
  app.post('/auth/verify-otp', {
    // Cap attempts so the 6-digit code can't be brute-forced.
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    try {
      const { accessToken, refreshToken } = await verifyPlayerOtp(
        parsed.data.phone,
        parsed.data.code,
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
