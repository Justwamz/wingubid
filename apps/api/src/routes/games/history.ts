import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticate } from '../../middleware/authenticate.js'

export async function gameHistoryRoutes(app: FastifyInstance) {
  app.get('/games/history', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT id, game_type, gross_stake, cashout_multiplier, winnings, status, created_at
       FROM bets WHERE player_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [req.playerId],
    )
    return reply.send(rows.map(r => ({
      betId: r.id,
      game: r.game_type,
      grossStake: Number(r.gross_stake),
      multiplier: r.cashout_multiplier ? Number(r.cashout_multiplier) : null,
      winnings: r.winnings ? Number(r.winnings) : null,
      status: r.status,
      createdAt: r.created_at,
    })))
  })
}
