import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticate } from '../../middleware/authenticate.js'
import { AppError } from '../../lib/errors.js'

interface AvailableRow { game_slug: string }
interface ProviderGameRow {
  game_slug: string
  provider_game_id: string
  launch_url_template: string
  base_url: string
  api_key: string
}

/**
 * Replace template variables in a launch URL:
 *   {gameId}   → provider's game ID
 *   {playerId} → player UUID
 *   {token}    → short-lived session token (api_key used as static token for now)
 *   {currency} → KES
 *   {lang}     → en
 */
function buildLaunchUrl(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (url, [k, v]) => url.replaceAll(`{${k}}`, encodeURIComponent(v)),
    template,
  )
}

export async function providerGameRoutes(app: FastifyInstance) {
  // Public: which third-party game slugs have an active provider configured.
  // Used by the landing page to show/hide COMING SOON.
  app.get('/games/available', async (_req, reply) => {
    const { rows } = await pool.query<AvailableRow>(
      `SELECT pg.game_slug
       FROM provider_games pg
       JOIN game_providers gp ON gp.id = pg.provider_id
       WHERE pg.active = true AND gp.active = true`,
    )
    return reply.send({ slugs: rows.map(r => r.game_slug) })
  })

  // Player: get a launch URL for a provider game. Requires auth.
  app.get('/games/launch/:slug', { preHandler: authenticate }, async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const playerId = (req as unknown as { playerId: string }).playerId

    const { rows } = await pool.query<ProviderGameRow>(
      `SELECT pg.game_slug, pg.provider_game_id, pg.launch_url_template,
              gp.base_url, gp.api_key
       FROM provider_games pg
       JOIN game_providers gp ON gp.id = pg.provider_id
       WHERE pg.game_slug = $1 AND pg.active = true AND gp.active = true
       LIMIT 1`,
      [slug],
    )

    if (rows.length === 0) {
      throw new AppError('NOT_FOUND', 'Game not available', 404)
    }

    const row = rows[0]
    const template = row.launch_url_template || `${row.base_url}/launch?gameId={gameId}&playerId={playerId}&token={token}&currency={currency}&lang={lang}`

    const launchUrl = buildLaunchUrl(template, {
      gameId:   row.provider_game_id,
      playerId,
      token:    row.api_key,
      currency: 'KES',
      lang:     'en',
    })

    return reply.send({ launchUrl })
  })
}
