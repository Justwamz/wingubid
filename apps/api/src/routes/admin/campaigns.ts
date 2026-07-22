import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { criteriaSchema, countMatchingPlayers } from '../../services/bonus-criteria.service.js'

async function audit(adminId: string, action: string, entityId: string | null, after: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO admin_audit_log (admin_id, action, entity, entity_id, after) VALUES ($1, $2, 'campaign', $3, $4::jsonb)`,
    [adminId, action, entityId, JSON.stringify(after ?? {})],
  )
}

const upsertBody = z.object({
  key: z.string().min(2).max(40).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers, underscores.'),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  type: z.enum(['welcome', 'custom']),
  amountCents: z.number().int().positive('Amount must be greater than zero.'),
  expiryDays: z.number().int().min(1).max(365).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  code: z.string().trim().min(2).max(40).optional(),
  criteria: criteriaSchema.optional(),
})

export async function adminCampaignRoutes(app: FastifyInstance) {
  app.get('/admin/campaigns', { preHandler: [authenticateAdmin, requirePermission('campaigns.view')] }, async (_req, reply) => {
    const { rows } = await pool.query(
      `SELECT c.id, c.key, c.name, c.description, c.type, c.amount_cents, c.expiry_days,
              c.starts_at, c.ends_at, c.status, c.created_at, c.code, c.criteria,
              (SELECT COUNT(*) FROM bonus_claims bc WHERE bc.campaign_id = c.id) AS claim_count
       FROM bonus_campaigns c ORDER BY c.created_at DESC LIMIT 200`,
    )
    return reply.send({ campaigns: rows })
  })

  app.post('/admin/campaigns', { preHandler: [authenticateAdmin, requirePermission('campaigns.manage')] }, async (req, reply) => {
    const parsed = upsertBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    const d = parsed.data
    try {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO bonus_campaigns (key, name, description, type, amount_cents, expiry_days, starts_at, ends_at, created_by, code, criteria)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING id`,
        [
          d.key, d.name, d.description ?? null, d.type, d.amountCents, d.expiryDays ?? 30, d.startsAt ?? null, d.endsAt ?? null, req.adminId,
          d.code ? d.code.toUpperCase() : null,
          d.criteria ? JSON.stringify(d.criteria) : null,
        ],
      )
      await audit(req.adminId, 'campaign_create', rows[0].id, d)
      return reply.send({ id: rows[0].id })
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        const constraint = (err as { constraint?: string }).constraint
        if (constraint === 'uq_bonus_campaigns_code') return reply.status(409).send({ error: { code: 'CODE_TAKEN', message: 'That promo code is already in use.' } })
        return reply.status(409).send({ error: { code: 'CAMPAIGN_KEY_TAKEN', message: 'That campaign key already exists.' } })
      }
      throw err
    }
  })

  app.put('/admin/campaigns/:id', { preHandler: [authenticateAdmin, requirePermission('campaigns.manage')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = upsertBody.partial().safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    const d = parsed.data
    try {
      const { rowCount } = await pool.query(
        `UPDATE bonus_campaigns SET
           name = COALESCE($2, name), description = COALESCE($3, description),
           amount_cents = COALESCE($4, amount_cents), expiry_days = COALESCE($5, expiry_days),
           starts_at = COALESCE($6, starts_at), ends_at = COALESCE($7, ends_at),
           code = COALESCE($8, code), criteria = COALESCE($9::jsonb, criteria)
         WHERE id = $1`,
        [
          id, d.name ?? null, d.description ?? null, d.amountCents ?? null, d.expiryDays ?? null, d.startsAt ?? null, d.endsAt ?? null,
          d.code ? d.code.toUpperCase() : null,
          d.criteria ? JSON.stringify(d.criteria) : null,
        ],
      )
      if (!rowCount) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Campaign not found.' } })
      await audit(req.adminId, 'campaign_update', id, d)
      return reply.send({ ok: true })
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        const constraint = (err as { constraint?: string }).constraint
        if (constraint === 'uq_bonus_campaigns_code') return reply.status(409).send({ error: { code: 'CODE_TAKEN', message: 'That promo code is already in use.' } })
        return reply.status(409).send({ error: { code: 'CAMPAIGN_KEY_TAKEN', message: 'That campaign key already exists.' } })
      }
      throw err
    }
  })

  app.put('/admin/campaigns/:id/status', { preHandler: [authenticateAdmin, requirePermission('campaigns.manage')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({ status: z.enum(['active', 'paused', 'ended']) }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid status.' } })
    const { rowCount } = await pool.query(`UPDATE bonus_campaigns SET status = $2 WHERE id = $1`, [id, parsed.data.status])
    if (!rowCount) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Campaign not found.' } })
    await audit(req.adminId, 'campaign_status', id, { status: parsed.data.status })
    return reply.send({ ok: true })
  })

  app.post('/admin/campaigns/preview-count', { preHandler: [authenticateAdmin, requirePermission('campaigns.view')] }, async (req, reply) => {
    const parsed = z.object({ criteria: criteriaSchema.optional() }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    const count = await countMatchingPlayers(parsed.data.criteria ?? null)
    return reply.send({ count })
  })
}
