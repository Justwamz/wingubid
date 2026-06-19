import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'

const VALID_SLUGS = ['aviator', 'aviatrix', 'jetx', 'bball-blitz', 'sun-of-egypt-4'] as const

const createBody = z.object({
  name:      z.string().min(1).max(100),
  slug:      z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  baseUrl:   z.string().url().max(500).or(z.literal('')),
  apiKey:    z.string().max(500).default(''),
  apiSecret: z.string().max(500).default(''),
  active:    z.boolean().default(true),
})

const updateBody = createBody.partial().omit({ slug: true })

const addGameBody = z.object({
  gameSlug:          z.enum(VALID_SLUGS),
  providerGameId:    z.string().max(200).default(''),
  launchUrlTemplate: z.string().max(1000).default(''),
  active:            z.boolean().default(true),
})

interface ProviderRow {
  id: string; name: string; slug: string; base_url: string
  api_key: string; api_secret: string; active: boolean; created_at: string; updated_at: string
}
interface GameRow {
  id: string; provider_id: string; game_slug: string
  provider_game_id: string; launch_url_template: string; active: boolean
}

function maskSecret(s: string) {
  if (!s || s.length < 6) return s ? '***' : ''
  return s.slice(0, 3) + '***' + s.slice(-3)
}

export async function adminGameProviderRoutes(app: FastifyInstance) {
  // List all providers with their game mappings
  app.get('/admin/game-providers', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const { rows: providers } = await pool.query<ProviderRow>(
      `SELECT * FROM game_providers ORDER BY created_at DESC`,
    )
    const { rows: games } = await pool.query<GameRow>(
      `SELECT * FROM provider_games ORDER BY created_at ASC`,
    )
    const result = providers.map(p => ({
      id:        p.id,
      name:      p.name,
      slug:      p.slug,
      baseUrl:   p.base_url,
      apiKey:    maskSecret(p.api_key),
      active:    p.active,
      createdAt: p.created_at,
      games: games
        .filter(g => g.provider_id === p.id)
        .map(g => ({
          gameSlug:          g.game_slug,
          providerGameId:    g.provider_game_id,
          launchUrlTemplate: g.launch_url_template,
          active:            g.active,
        })),
    }))
    return reply.send({ providers: result })
  })

  // Create provider
  app.post('/admin/game-providers', { preHandler: authenticateAdmin }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    const { name, slug, baseUrl, apiKey, apiSecret, active } = parsed.data
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO game_providers (name, slug, base_url, api_key, api_secret, active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [name, slug, baseUrl, apiKey, apiSecret, active],
    )
    return reply.status(201).send({ id: rows[0].id })
  })

  // Update provider
  app.put('/admin/game-providers/:id', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    const d = parsed.data
    await pool.query(
      `UPDATE game_providers SET
         name      = COALESCE($1, name),
         base_url  = COALESCE($2, base_url),
         api_key   = COALESCE($3, api_key),
         api_secret= COALESCE($4, api_secret),
         active    = COALESCE($5, active),
         updated_at= NOW()
       WHERE id = $6`,
      [d.name ?? null, d.baseUrl ?? null, d.apiKey ?? null, d.apiSecret ?? null, d.active ?? null, id],
    )
    return reply.send({ ok: true })
  })

  // Delete provider
  app.delete('/admin/game-providers/:id', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await pool.query(`DELETE FROM game_providers WHERE id = $1`, [id])
    return reply.status(204).send()
  })

  // Add / update a game mapping for a provider
  app.post('/admin/game-providers/:id/games', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = addGameBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    const { gameSlug, providerGameId, launchUrlTemplate, active } = parsed.data
    // Upsert — if the game_slug is already mapped to another provider, replace it
    await pool.query(
      `INSERT INTO provider_games (provider_id, game_slug, provider_game_id, launch_url_template, active)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (game_slug) DO UPDATE SET
         provider_id         = EXCLUDED.provider_id,
         provider_game_id    = EXCLUDED.provider_game_id,
         launch_url_template = EXCLUDED.launch_url_template,
         active              = EXCLUDED.active`,
      [id, gameSlug, providerGameId, launchUrlTemplate, active],
    )
    return reply.status(201).send({ ok: true })
  })

  // Remove a game mapping
  app.delete('/admin/game-providers/:id/games/:gameSlug', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { id, gameSlug } = req.params as { id: string; gameSlug: string }
    await pool.query(
      `DELETE FROM provider_games WHERE provider_id = $1 AND game_slug = $2`,
      [id, gameSlug],
    )
    return reply.status(204).send()
  })
}
