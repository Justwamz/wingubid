import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'

export async function adminStatsRoutes(app: FastifyInstance) {
  app.get('/admin/stats', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const [
      playersRes,
      depositRes,
      betPlacedRes,
      betWonRes,
      walletRes,
      betCountRes,
      recentBetsRes,
    ] = await Promise.all([
      pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM players`),
      pool.query<{ total: string }>(`SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = 'deposit' AND status = 'completed'`),
      pool.query<{ total: string }>(`SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = 'bet_placed'`),
      pool.query<{ total: string }>(`SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE type = 'bet_won'`),
      pool.query<{ total: string }>(`SELECT COALESCE(SUM(balance), 0) AS total FROM wallets`),
      pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM bets`),
      pool.query<{
        id: string; player_name: string; game_type: string
        gross_stake: string; winnings: string | null; status: string; created_at: string
      }>(`
        SELECT b.id, p.name AS player_name, b.game_type,
               b.gross_stake, b.winnings, b.status, b.created_at
        FROM bets b
        JOIN players p ON p.id = b.player_id
        ORDER BY b.created_at DESC
        LIMIT 20
      `),
    ])

    const totalBetPlaced = Number(betPlacedRes.rows[0].total)
    const totalBetWon = Number(betWonRes.rows[0].total)

    return reply.send({
      totalPlayers:   Number(playersRes.rows[0].count),
      totalDeposits:  Number(depositRes.rows[0].total),
      totalBetVolume: totalBetPlaced,
      totalPaidOut:   totalBetWon,
      houseRevenue:   totalBetPlaced - totalBetWon,
      totalHeldBalance: Number(walletRes.rows[0].total),
      totalBets:      Number(betCountRes.rows[0].count),
      recentBets: recentBetsRes.rows.map(b => ({
        id:         b.id,
        playerName: b.player_name,
        gameType:   b.game_type,
        grossStake: Number(b.gross_stake),
        winnings:   b.winnings !== null ? Number(b.winnings) : null,
        status:     b.status,
        createdAt:  b.created_at,
      })),
    })
  })
}
