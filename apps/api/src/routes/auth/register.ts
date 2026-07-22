import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { registerPlayer, AppError } from '../../services/auth.service.js'
import { normalizeKePhone, isSafaricom } from '../../lib/phone.js'

const body = z.object({
  // Accept any supported input format; normalize to +254 E.164 and require an
  // approved Safaricom prefix.
  phone: z.string({ required_error: 'Please enter your phone number.' })
    .refine(s => { const n = normalizeKePhone(s); return n != null && isSafaricom(n) }, 'Please enter a valid Safaricom number.')
    .transform(s => normalizeKePhone(s)!),
  name: z.string({ required_error: 'Please enter your full name.' }).min(2, 'Please enter your full name.'),
  country: z.enum(['KE', 'UG', 'TZ', 'RW'], { errorMap: () => ({ message: 'Please choose your country.' }) }),
  date_of_birth: z.string({ required_error: 'Please enter your date of birth.' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Please enter your date of birth.').refine((dob) => {
    const age = (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    return age >= 18
  }, 'You must be at least 18 years old to register.'),
  password: z.string({ required_error: 'Please create a password.' }).min(4, 'Your password must be at least 4 characters.'),
  deviceId: z.string().max(64).optional(),
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
      const tokens = await registerPlayer({
        ...parsed.data,
        currency: currencyMap[country],
        ip: req.ip,
        deviceId: parsed.data.deviceId,
      })
      if (tokens) {
        reply.setCookie('refresh_token', tokens.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
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
