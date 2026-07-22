import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { grantBonus } from '../../services/wallet.service.js'
import { getBonusDefaultExpiryDays } from '../../services/game-settings.service.js'

async function audit(adminId: string, action: string, entityId: string | null, after: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO admin_audit_log (admin_id, action, entity, entity_id, after) VALUES ($1, $2, 'bonus', $3, $4::jsonb)`,
    [adminId, action, entityId, JSON.stringify(after ?? {})],
  )
}

export async function adminBonusRoutes(app: FastifyInstance) {
  app.get('/admin/bonuses', { preHandler: [authenticateAdmin, requirePermission('bonuses.view')] }, async (_req, reply) => {
    const { rows } = await pool.query(
      `SELECT bg.id, bg.amount_granted, bg.remaining, bg.status, bg.expires_at, bg.created_at,
              p.name AS player_name, p.phone AS player_phone
       FROM bonus_grants bg JOIN players p ON p.id = bg.player_id
       ORDER BY bg.created_at DESC LIMIT 100`,
    )
    return reply.send({ bonuses: rows })
  })

  app.post('/admin/bonuses/grant', { preHandler: [authenticateAdmin, requirePermission('bonuses.grant')] }, async (req, reply) => {
    // Admins identify players by phone (the natural handle); a player UUID is
    // also accepted for flexibility. Exactly one is required.
    const parsed = z.object({
      phone: z.string().trim().min(1).optional(),
      playerId: z.string().uuid().optional(),
      amountCents: z.number().int().positive('Amount must be greater than zero.'),
      expiresInDays: z.number().int().min(1).max(365).optional(),
    }).refine(d => Boolean(d.phone) || Boolean(d.playerId), { message: 'Enter a player phone number.' })
      .safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    const { rows: playerRows } = parsed.data.playerId
      ? await pool.query<{ id: string }>(`SELECT id FROM players WHERE id = $1`, [parsed.data.playerId])
      : await pool.query<{ id: string }>(`SELECT id FROM players WHERE phone = $1`, [parsed.data.phone])
    if (playerRows.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No player found with that phone number.' } })
    const playerId = playerRows[0].id

    const { rows: active } = await pool.query<{ id: string }>(
      `SELECT id FROM bonus_grants WHERE player_id = $1 AND status = 'active'`, [playerId],
    )
    if (active.length > 0) {
      return reply.status(409).send({ error: { code: 'ACTIVE_BONUS_EXISTS', message: 'This player already has an active bonus.' } })
    }

    const days = parsed.data.expiresInDays ?? await getBonusDefaultExpiryDays()
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { grantId } = await grantBonus(client, playerId, parsed.data.amountCents, req.adminId, expiresAt)
      await client.query('COMMIT')
      await audit(req.adminId, 'bonus_grant', grantId, { playerId, amountCents: parsed.data.amountCents, expiresAt })
      return reply.send({ grantId, remaining: parsed.data.amountCents })
    } catch (err) {
      await client.query('ROLLBACK')
      if ((err as { code?: string }).code === '23505') {
        return reply.status(409).send({ error: { code: 'ACTIVE_BONUS_EXISTS', message: 'This player already has an active bonus.' } })
      }
      throw err
    } finally {
      client.release()
    }
  })
}
