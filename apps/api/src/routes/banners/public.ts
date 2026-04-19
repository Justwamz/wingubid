import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticate } from '../../middleware/authenticate.js'

interface BannerRow {
  id: string; headline: string; subtext: string; cta_text: string
  cta_url: string; image_url: string; gradient: string
}

async function getActiveBanner(placement: string) {
  const { rows } = await pool.query<BannerRow>(
    `SELECT id, headline, subtext, cta_text, cta_url, image_url, gradient
     FROM banners WHERE placement = $1 AND active = true LIMIT 1`,
    [placement],
  )
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    id: r.id, headline: r.headline, subtext: r.subtext,
    ctaText: r.cta_text, ctaUrl: r.cta_url, imageUrl: r.image_url, gradient: r.gradient,
  }
}

export async function bannerPublicRoutes(app: FastifyInstance) {
  // Landing banner — no auth (public)
  app.get('/banners/landing', async (_req, reply) => {
    return reply.send({ banner: await getActiveBanner('landing') })
  })

  // Lobby banner — requires player JWT
  app.get('/banners/lobby', { preHandler: authenticate }, async (_req, reply) => {
    return reply.send({ banner: await getActiveBanner('lobby') })
  })
}
