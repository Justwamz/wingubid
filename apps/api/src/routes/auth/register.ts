import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { registerPlayer, AppError } from '../../services/auth.service.js'

const body = z.object({
  phone: z.string().regex(/^\+\d{9,15}$/, 'Must be E.164 format, e.g. +254700000000'),
  name: z.string().min(2),
  country: z.enum(['KE', 'UG', 'TZ', 'RW']),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((dob) => {
    const age = (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    return age >= 18
  }, 'Must be 18 or older'),
  password: z.string().min(8),
})

export async function registerRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    const country = parsed.data.country
    const currencyMap: Record<string, string> = { KE: 'KES', UG: 'UGX', TZ: 'TZS', RW: 'RWF' }

    try {
      const tokens = await registerPlayer({ ...parsed.data, currency: currencyMap[country] })
      if (tokens) {
        reply.setCookie('refresh_token', tokens.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/auth/refresh',
          maxAge: 7 * 24 * 60 * 60,
        })
        return reply.status(201).send({ access_token: tokens.accessToken })
      }
      return reply.status(201).send({ message: `OTP sent to ${parsed.data.phone}` })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })
}
