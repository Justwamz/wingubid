import type { FastifyInstance } from 'fastify'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { pool } from '@betting/db'

// Lightweight counts for the admin notification bell + tab badges.
export async function adminNotificationRoutes(app: FastifyInstance) {
  app.get('/admin/pending-counts', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const { rows: w } = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM payment_transactions WHERE type = 'withdrawal' AND status = 'awaiting_approval'`,
    )
    const { rows: c } = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM c2b_payments WHERE status = 'unresolved'`,
    )
    const withdrawalsAwaitingApproval = Number(w[0].n)
    const c2bUnresolved = Number(c[0].n)
    return reply.send({
      withdrawalsAwaitingApproval,
      c2bUnresolved,
      total: withdrawalsAwaitingApproval + c2bUnresolved,
    })
  })
}
