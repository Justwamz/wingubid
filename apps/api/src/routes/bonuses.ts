import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticate } from '../middleware/authenticate.js'
import { AppError } from '../lib/errors.js'
import { claimCampaignBonus } from '../services/bonus-claim.service.js'

export async function bonusPlayerRoutes(app: FastifyInstance) {
  // Active, in-window campaigns this player has not claimed. `claimable` is the
  // cheap check (not claimed, no active bonus); the full abuse check runs at claim.
  app.get('/bonuses/available', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT c.id, c.key, c.name, c.description, c.amount_cents,
              (NOT EXISTS (SELECT 1 FROM bonus_grants g WHERE g.player_id = $1 AND g.status = 'active')) AS claimable
       FROM bonus_campaigns c
       WHERE c.status = 'active'
         AND (c.starts_at IS NULL OR c.starts_at <= NOW())
         AND (c.ends_at IS NULL OR c.ends_at >= NOW())
         AND NOT EXISTS (SELECT 1 FROM bonus_claims bc WHERE bc.campaign_id = c.id AND bc.player_id = $1)
       ORDER BY c.created_at DESC`,
      [req.playerId],
    )
    return reply.send({ campaigns: rows.map(r => ({
      id: r.id, key: r.key, name: r.name, description: r.description,
      amountCents: Number(r.amount_cents), claimable: r.claimable,
    })) })
  })

  app.post('/bonuses/claim', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({
      campaignId: z.string().uuid(),
      deviceId: z.string().max(64).optional(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    try {
      const { amountCents } = await claimCampaignBonus(req.playerId, parsed.data.campaignId, req.ip, parsed.data.deviceId)
      return reply.send({ ok: true, amountCents })
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })
}
