import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticate } from '../../middleware/authenticate.js'
import { AppError } from '../../services/auth.service.js'

const selfExcludeBody = z.object({
  period: z.enum(['7d', '30d', '90d', 'permanent']),
})

const PERIOD_DAYS: Record<string, number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  permanent: null,
}

export async function playerMeRoutes(app: FastifyInstance) {
  app.get('/player/me', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await pool.query<{
      id: string; name: string; phone: string; country: string
      currency: string; status: string; created_at: string
      balance: string; bonus_balance: string; locked_balance: string
    }>(
      `SELECT p.id, p.name, p.phone, p.country, p.currency, p.status, p.created_at,
              w.balance, w.bonus_balance, w.locked_balance
       FROM players p
       JOIN wallets w ON w.player_id = p.id
       WHERE p.id = $1`,
      [req.playerId],
    )

    if (rows.length === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Player not found' } })
    }

    const p = rows[0]
    return reply.send({
      id: p.id,
      name: p.name,
      phone: p.phone,
      country: p.country,
      currency: p.currency,
      status: p.status,
      created_at: p.created_at,
      wallet: {
        balance: Number(p.balance),
        bonus_balance: Number(p.bonus_balance),
        locked_balance: Number(p.locked_balance),
      },
    })
  })

  app.post('/player/me/self-exclude', { preHandler: authenticate }, async (req, reply) => {
    const parsed = selfExcludeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    const days = PERIOD_DAYS[parsed.data.period]
    const excludedUntil = days
      ? new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      : null

    await pool.query(
      `UPDATE players
       SET status = 'self_excluded', self_excluded_until = $2
       WHERE id = $1`,
      [req.playerId, excludedUntil],
    )

    return reply.send({ message: 'Self-exclusion applied' })
  })
}
