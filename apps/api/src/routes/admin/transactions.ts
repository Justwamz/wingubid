import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'

export async function adminTransactionsRoutes(app: FastifyInstance) {
  app.get('/admin/transactions', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const { rows } = await pool.query<{
      id: string; type: string; amount: string; balance_after: string
      created_at: string; player_name: string
    }>(
      `SELECT t.id, t.type, t.amount, t.balance_after, t.created_at,
              p.name AS player_name
       FROM transactions t
       JOIN players p ON p.id = t.player_id
       WHERE t.type != 'demo_topup'
       ORDER BY t.created_at DESC
       LIMIT 200`,
    )

    return reply.send({
      transactions: rows.map(r => ({
        id: r.id,
        playerName: r.player_name,
        type: r.type,
        amount: Number(r.amount),
        balanceAfter: Number(r.balance_after),
        createdAt: r.created_at,
      })),
    })
  })
}
