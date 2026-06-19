import type { FastifyInstance } from 'fastify'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { pool } from '@betting/db'

export async function adminGameSlotRoutes(app: FastifyInstance) {
  // List all slots with their current provider assignment
  app.get('/admin/game-slots', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const pool = pool
    const { rows } = await pool.query<{
      id: string; name: string; slug: string; created_at: string
      provider_game_id: string | null; launch_url_template: string | null
      assignment_active: boolean | null
      provider_id: string | null; provider_name: string | null; provider_slug: string | null
    }>(`
      SELECT
        gs.id, gs.name, gs.slug, gs.created_at,
        pg.provider_game_id,
        pg.launch_url_template,
        pg.active  AS assignment_active,
        gp.id      AS provider_id,
        gp.name    AS provider_name,
        gp.slug    AS provider_slug
      FROM game_slots gs
      LEFT JOIN provider_games pg ON pg.game_slug = gs.slug
      LEFT JOIN game_providers gp ON gp.id = pg.provider_id
      ORDER BY gs.created_at
    `)

    const slots = rows.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      createdAt: r.created_at,
      assignment: r.provider_id ? {
        providerGameId: r.provider_game_id ?? '',
        launchUrlTemplate: r.launch_url_template ?? '',
        active: r.assignment_active ?? false,
        provider: { id: r.provider_id, name: r.provider_name, slug: r.provider_slug },
      } : null,
    }))

    return reply.send({ slots })
  })

  // Create a new game slot
  app.post('/admin/game-slots', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { name, slug } = req.body as { name?: string; slug?: string }
    if (!name?.trim() || !slug?.trim()) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'name and slug are required' } })
    }
    const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!cleanSlug) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'slug must contain letters or numbers' } })
    }
    const pool = pool
    try {
      const { rows } = await pool.query(
        `INSERT INTO game_slots (name, slug) VALUES ($1, $2) RETURNING id, name, slug, created_at`,
        [name.trim().slice(0, 100), cleanSlug.slice(0, 50)],
      )
      return reply.status(201).send({ slot: rows[0] })
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        return reply.status(409).send({ error: { code: 'CONFLICT', message: `Slot "${cleanSlug}" already exists` } })
      }
      throw err
    }
  })

  // Delete a game slot (only if no active assignment)
  app.delete('/admin/game-slots/:slug', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const pool = pool
    const { rows: existing } = await pool.query(
      `SELECT pg.id FROM game_slots gs LEFT JOIN provider_games pg ON pg.game_slug = gs.slug WHERE gs.slug = $1`,
      [slug],
    )
    if (existing.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Slot not found' } })
    if (existing[0].id) {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: 'Remove the provider assignment before deleting this slot' } })
    }
    await pool.query(`DELETE FROM game_slots WHERE slug = $1`, [slug])
    return reply.status(204).send()
  })
}
