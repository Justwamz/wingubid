import type { FastifyInstance } from 'fastify'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { pool } from '@betting/db'
import { invalidateSmsConfigCache } from '../../services/sms-config.service.js'

const PROVIDER = 'africastalking'

function maskApiKey(config: Record<string, string>) {
  const masked = { ...config }
  if (masked.apiKey) {
    const v = masked.apiKey
    masked.apiKey = v.length > 6 ? v.slice(0, 3) + '***' + v.slice(-3) : '***'
  }
  return masked
}

export async function adminSmsConfigRoutes(app: FastifyInstance) {
  // GET the SMS/OTP provider config (API key masked)
  app.get('/admin/sms-config', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const { rows } = await pool.query<{
      provider: string; enabled: boolean; config: Record<string, string>; updated_at: string
    }>(`SELECT provider, enabled, config, updated_at FROM sms_configs WHERE provider = $1`, [PROVIDER])

    const row = rows[0]
    return reply.send({
      config: {
        provider: PROVIDER,
        enabled: row?.enabled ?? false,
        config: maskApiKey(row?.config ?? {}),
        updatedAt: row?.updated_at ?? null,
      },
    })
  })

  // PUT - update the SMS provider config (partial merge so credentials aren't wiped)
  app.put('/admin/sms-config', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { enabled, config } = req.body as {
      enabled?: boolean
      config?: Record<string, string>
    }

    const { rows: existing } = await pool.query<{ config: Record<string, string> }>(
      `SELECT config FROM sms_configs WHERE provider = $1`,
      [PROVIDER],
    )
    const current = existing[0]?.config ?? {}
    // Ignore a masked apiKey coming back from the client (contains '***'), so
    // re-saving without retyping the key doesn't clobber the stored value.
    const incoming = { ...(config ?? {}) }
    if (typeof incoming.apiKey === 'string' && incoming.apiKey.includes('***')) delete incoming.apiKey
    const merged = { ...current, ...incoming }

    await pool.query(
      `INSERT INTO sms_configs (provider, enabled, config, updated_at)
       VALUES ($1, COALESCE($2, false), $3, NOW())
       ON CONFLICT (provider) DO UPDATE
         SET enabled = COALESCE($2, sms_configs.enabled),
             config = $3,
             updated_at = NOW()`,
      [PROVIDER, enabled ?? null, JSON.stringify(merged)],
    )

    invalidateSmsConfigCache()
    return reply.send({ ok: true })
  })
}
