import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticate } from '../middleware/authenticate.js'
import { AppError } from '../lib/errors.js'
import { claimCampaignBonus, resolveCampaignByCode } from '../services/bonus-claim.service.js'
import { playerMatchesCriteria } from '../services/bonus-criteria.service.js'

export async function bonusPlayerRoutes(app: FastifyInstance) {
  // Active, in-window campaigns this player has not claimed. `claimable` is the
  // cheap check (not claimed, no active bonus); the full abuse check runs at claim.
  // Code-gated campaigns are excluded here (players must have the code); targeted
  // campaigns are filtered live against the player's criteria match.
  app.get('/bonuses/available', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await pool.query<{
      id: string; key: string; name: string; description: string | null
      amount_cents: string; criteria: import('../services/bonus-criteria.service.js').Criteria | null; claimable: boolean
    }>(
      `SELECT c.id, c.key, c.name, c.description, c.amount_cents, c.criteria,
              (NOT EXISTS (SELECT 1 FROM bonus_grants g WHERE g.player_id = $1 AND g.status = 'active')) AS claimable
       FROM bonus_campaigns c
       WHERE c.status = 'active' AND c.code IS NULL
         AND c.reward_kind = 'fixed'
         AND (c.starts_at IS NULL OR c.starts_at <= NOW())
         AND (c.ends_at IS NULL OR c.ends_at >= NOW())
         AND NOT EXISTS (SELECT 1 FROM bonus_claims bc WHERE bc.campaign_id = c.id AND bc.player_id = $1)
       ORDER BY c.created_at DESC`,
      [req.playerId],
    )
    const out = []
    for (const r of rows) {
      if (r.criteria && !(await playerMatchesCriteria(req.playerId, r.criteria))) continue
      out.push({ id: r.id, key: r.key, name: r.name, description: r.description, amountCents: Number(r.amount_cents), claimable: r.claimable })
    }
    return reply.send({ campaigns: out })
  })

  app.post('/bonuses/claim', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({
      campaignId: z.string().uuid().optional(),
      code: z.string().min(1).max(40).optional(),
      deviceId: z.string().max(64).optional(),
    }).refine(d => Boolean(d.campaignId) || Boolean(d.code), { message: 'Provide a bonus or a promo code.' })
      .safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    try {
      let campaignId = parsed.data.campaignId
      if (!campaignId && parsed.data.code) {
        campaignId = (await resolveCampaignByCode(parsed.data.code)) ?? undefined
        if (!campaignId) return reply.status(422).send({ error: { code: 'INVALID_CODE', message: 'That promo code is not valid.' } })
      }
      const { amountCents } = await claimCampaignBonus(req.playerId, campaignId!, req.ip, parsed.data.deviceId, parsed.data.code)
      return reply.send({ ok: true, amountCents })
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })
}
