import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticate } from '../../middleware/authenticate.js'

interface BannerRow {
  id: string; headline: string; subtext: string; cta_text: string
  cta_url: string; image_url: string; gradient: string
  campaign_id: string | null; campaign_code: string | null
}

async function getActiveBanner(placement: string) {
  const { rows } = await pool.query<BannerRow>(
    `SELECT b.id, b.headline, b.subtext, b.cta_text, b.cta_url, b.image_url, b.gradient,
            b.campaign_id, c.code AS campaign_code
     FROM banners b LEFT JOIN bonus_campaigns c ON c.id = b.campaign_id
     WHERE b.placement = $1 AND b.active = true LIMIT 1`,
    [placement],
  )
  if (rows.length === 0) return null
  const r = rows[0]
  const ctaUrl = r.campaign_id
    ? (r.campaign_code ? `/rewards?code=${encodeURIComponent(r.campaign_code)}` : '/rewards')
    : r.cta_url
  return {
    id: r.id, headline: r.headline, subtext: r.subtext,
    ctaText: r.cta_text, ctaUrl, imageUrl: r.image_url, gradient: r.gradient,
  }
}

export async function bannerPublicRoutes(app: FastifyInstance) {
  // Landing banner - no auth (public)
  app.get('/banners/landing', async (_req, reply) => {
    return reply.send({ banner: await getActiveBanner('landing') })
  })

  // Lobby banner - requires player JWT
  app.get('/banners/lobby', { preHandler: authenticate }, async (_req, reply) => {
    return reply.send({ banner: await getActiveBanner('lobby') })
  })
}
