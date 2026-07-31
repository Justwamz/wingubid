import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { requirePermission } from '../../middleware/requirePermission.js'

const putBody = z.object({
  country: z.enum(['KE', 'UG', 'TZ', 'RW']),
  taxType: z.enum(['wager_tax', 'withdrawal_tax']),
  rate: z.number().min(0).max(100),
  enabled: z.boolean(),
})

export async function adminTaxRoutes(app: FastifyInstance) {
  app.get('/admin/tax-rules', { preHandler: [authenticateAdmin, requirePermission('taxes.view')] }, async (_req, reply) => {
    const { rows } = await pool.query<{ country: string; tax_type: string; rate: string; enabled: boolean }>(
      `SELECT country, tax_type, rate, enabled FROM tax_rules ORDER BY country, tax_type`,
    )
    return reply.send({ rules: rows.map(r => ({
      country: r.country, taxType: r.tax_type, rate: Number(r.rate), enabled: r.enabled,
    })) })
  })

  app.put('/admin/tax-rules', { preHandler: [authenticateAdmin, requirePermission('taxes.edit')] }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    const d = parsed.data
    await pool.query(
      `INSERT INTO tax_rules (country, tax_type, rate, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (country, tax_type) DO UPDATE SET rate = EXCLUDED.rate, enabled = EXCLUDED.enabled`,
      [d.country, d.taxType, d.rate, d.enabled],
    )
    return reply.send({ ok: true })
  })
}
