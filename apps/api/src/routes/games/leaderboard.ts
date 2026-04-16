import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'

export async function gameLeaderboardRoutes(app: FastifyInstance) {
  app.get('/games/leaderboard', async (_req, reply) => {
    const { rows } = await pool.query(
      `SELECT p.first_name AS player_name, b.game_type AS game,
              b.cashout_multiplier AS multiplier, b.winnings, w.currency, b.settled_at AS won_at
       FROM bets b
       JOIN players p ON p.id = b.player_id
       JOIN wallets w ON w.player_id = b.player_id
       WHERE b.status = 'won' AND b.winnings IS NOT NULL
       ORDER BY b.settled_at DESC LIMIT 10`,
    )
    return reply.send(rows.map(r => ({
      playerName: r.player_name,
      game: r.game,
      multiplier: Number(r.multiplier),
      winnings: Number(r.winnings),
      currency: r.currency,
      wonAt: r.won_at,
    })))
  })
}
