import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'

const bannerBody = z.object({
  placement: z.enum(['landing', 'lobby']),
  headline: z.string().min(1).max(80),
  subtext: z.string().max(160).default(''),
  ctaText: z.string().max(40).default(''),
  ctaUrl: z.string().max(255).default('/wallet/deposit'),
  imageUrl: z.string().max(500).default(''),
  gradient: z.string().max(100).default('from-cyan-900/60 to-violet-900/40'),
  campaignId: z.string().uuid().nullish(),
})

const updateBody = bannerBody.partial().omit({ placement: true })

export async function adminBannerRoutes(app: FastifyInstance) {
  app.get('/admin/banners', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const { rows } = await pool.query(
      `SELECT b.id, b.placement, b.headline, b.subtext, b.cta_text, b.cta_url, b.image_url,
              b.gradient, b.active, b.created_at, b.campaign_id, c.name AS campaign_name
       FROM banners b LEFT JOIN bonus_campaigns c ON c.id = b.campaign_id
       ORDER BY b.placement, b.created_at DESC`,
    )
    return reply.send({ banners: rows.map(r => ({
      id: r.id, placement: r.placement, headline: r.headline, subtext: r.subtext,
      ctaText: r.cta_text, ctaUrl: r.cta_url, imageUrl: r.image_url,
      gradient: r.gradient, active: r.active, createdAt: r.created_at,
      campaignId: r.campaign_id, campaignName: r.campaign_name,
    })) })
  })

  app.get('/admin/banners/campaign-options', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const { rows } = await pool.query<{ id: string; name: string; code: string | null }>(
      `SELECT id, name, code FROM bonus_campaigns WHERE status = 'active' ORDER BY created_at DESC`,
    )
    return reply.send({ campaigns: rows.map(r => ({ id: r.id, name: r.name, code: r.code })) })
  })

  app.post('/admin/banners', { preHandler: authenticateAdmin }, async (req, reply) => {
    const parsed = bannerBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    const d = parsed.data
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO banners (placement, headline, subtext, cta_text, cta_url, image_url, gradient, campaign_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [d.placement, d.headline, d.subtext, d.ctaText, d.ctaUrl, d.imageUrl, d.gradient, d.campaignId ?? null],
    )
    return reply.status(201).send({ id: rows[0].id })
  })

  app.put('/admin/banners/:id', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    const d = parsed.data
    const body = (req.body ?? {}) as Record<string, unknown>
    const sets = [
      'headline  = COALESCE($1, headline)',
      'subtext   = COALESCE($2, subtext)',
      'cta_text  = COALESCE($3, cta_text)',
      'cta_url   = COALESCE($4, cta_url)',
      'image_url = COALESCE($5, image_url)',
      'gradient  = COALESCE($6, gradient)',
      'updated_at = NOW()',
    ]
    const vals: unknown[] = [
      d.headline ?? null, d.subtext ?? null, d.ctaText ?? null,
      d.ctaUrl ?? null, d.imageUrl ?? null, d.gradient ?? null,
    ]
    let n = vals.length // 6
    if ('campaignId' in body) { sets.push(`campaign_id = $${++n}`); vals.push(d.campaignId ?? null) }
    vals.push(id) // id is the last param
    await pool.query(`UPDATE banners SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals)
    return reply.send({ ok: true })
  })

  app.put('/admin/banners/:id/activate', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await pool.query<{ placement: string }>(
      `SELECT placement FROM banners WHERE id = $1`, [id],
    )
    if (rows.length === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Banner not found' } })
    }
    const { placement } = rows[0]
    await pool.query(`UPDATE banners SET active = false WHERE placement = $1`, [placement])
    await pool.query(`UPDATE banners SET active = true, updated_at = NOW() WHERE id = $1`, [id])
    return reply.send({ ok: true })
  })

  app.delete('/admin/banners/:id', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await pool.query(`DELETE FROM banners WHERE id = $1`, [id])
    return reply.status(204).send()
  })
}
