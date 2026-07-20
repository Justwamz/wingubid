import type { FastifyInstance } from 'fastify'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { pool } from '@betting/db'
import { invalidateEmailConfigCache } from '../../services/email-config.service.js'

function maskApiKey(config: Record<string, string>) {
  const masked = { ...config }
  if (masked.apiKey) {
    const v = masked.apiKey
    masked.apiKey = v.length > 6 ? v.slice(0, 3) + '***' + v.slice(-3) : '***'
  }
  return masked
}

export async function adminEmailConfigRoutes(app: FastifyInstance) {
  app.get('/admin/email-config', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const { rows } = await pool.query<{ enabled: boolean; config: Record<string, string> }>(
      `SELECT enabled, config FROM email_configs ORDER BY updated_at DESC LIMIT 1`,
    )
    return reply.send({
      config: {
        enabled: rows[0]?.enabled ?? false,
        config: maskApiKey(rows[0]?.config ?? {}),
      },
    })
  })

  app.put('/admin/email-config', { preHandler: authenticateAdmin }, async (req, reply) => {
    const body = (req.body ?? {}) as { enabled?: boolean; config?: Record<string, string> }

    const { rows } = await pool.query<{ id: string; enabled: boolean; config: Record<string, string> }>(
      `SELECT id, enabled, config FROM email_configs ORDER BY updated_at DESC LIMIT 1`,
    )
    const existing = rows[0]
    const incoming = { ...(body.config ?? {}) }
    // Drop a masked apiKey so re-saving never clobbers the stored key.
    if (typeof incoming.apiKey === 'string' && incoming.apiKey.includes('***')) delete incoming.apiKey
    const merged = { ...(existing?.config ?? {}), ...incoming }
    const enabled = body.enabled ?? existing?.enabled ?? false

    if (existing) {
      await pool.query(
        `UPDATE email_configs SET enabled = $1, config = $2::jsonb, updated_at = NOW() WHERE id = $3`,
        [enabled, JSON.stringify(merged), existing.id],
      )
    } else {
      await pool.query(
        `INSERT INTO email_configs (enabled, config) VALUES ($1, $2::jsonb)`,
        [enabled, JSON.stringify(merged)],
      )
    }
    invalidateEmailConfigCache()
    return reply.send({ ok: true })
  })
}
