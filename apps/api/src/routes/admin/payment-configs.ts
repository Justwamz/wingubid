import type { FastifyInstance } from 'fastify'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { pool } from '@betting/db'

const PROVIDERS = ['mpesa', 'airtel'] as const
type Provider = typeof PROVIDERS[number]

// Fields that should be masked in API responses
const SENSITIVE_FIELDS: Record<Provider, string[]> = {
  mpesa:  ['consumerSecret', 'passkey', 'withdrawSecurityCredential'],
  airtel: ['clientSecret'],
}

function maskConfig(provider: Provider, config: Record<string, string>) {
  const masked = { ...config }
  for (const field of SENSITIVE_FIELDS[provider] ?? []) {
    if (masked[field]) {
      const v = masked[field]
      masked[field] = v.length > 6 ? v.slice(0, 3) + '***' + v.slice(-3) : '***'
    }
  }
  return masked
}

export async function adminPaymentConfigRoutes(app: FastifyInstance) {
  // GET all payment configs (credentials masked)
  app.get('/admin/payment-configs', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const { rows } = await pool.query<{
      provider: Provider; enabled: boolean; environment: string; config: Record<string, string>; updated_at: string
    }>(`SELECT provider, enabled, environment, config, updated_at FROM payment_configs ORDER BY provider`)

    const configs = rows.map(r => ({
      provider:    r.provider,
      enabled:     r.enabled,
      environment: r.environment,
      config:      maskConfig(r.provider, r.config),
      updatedAt:   r.updated_at,
    }))

    return reply.send({ configs })
  })

  // PUT - update a provider's config (full replace of credential fields)
  app.put('/admin/payment-configs/:provider', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { provider } = req.params as { provider: string }
    if (!PROVIDERS.includes(provider as Provider)) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: `Unknown provider: ${provider}` } })
    }

    const { enabled, environment, config } = req.body as {
      enabled?: boolean
      environment?: 'sandbox' | 'production'
      config?: Record<string, string>
    }

    if (environment && !['sandbox', 'production'].includes(environment)) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'environment must be sandbox or production' } })
    }

    // Merge new config fields over existing ones (so partial updates don't wipe credentials)
    const { rows: existing } = await pool.query<{ config: Record<string, string> }>(
      `SELECT config FROM payment_configs WHERE provider = $1`,
      [provider],
    )
    const currentConfig = existing[0]?.config ?? {}
    const mergedConfig = config ? { ...currentConfig, ...config } : currentConfig

    await pool.query(
      `UPDATE payment_configs
       SET enabled     = COALESCE($1, enabled),
           environment = COALESCE($2, environment),
           config      = $3,
           updated_at  = NOW()
       WHERE provider = $4`,
      [enabled ?? null, environment ?? null, JSON.stringify(mergedConfig), provider],
    )

    return reply.send({ ok: true })
  })
}
