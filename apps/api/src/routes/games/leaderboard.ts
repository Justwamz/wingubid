import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'

// The leaderboard is public, so never expose full player names (PII). Show only
// the first initial of the first name, masked.
function maskName(name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? ''
  if (first.length <= 1) return first ? `${first}•••` : 'Player'
  return first[0] + '•'.repeat(Math.min(first.length - 1, 4))
}

export async function gameLeaderboardRoutes(app: FastifyInstance) {
  app.get('/games/leaderboard', async (_req, reply) => {
    // Join wallets on the exact wallet used for the bet (b.wallet_id), not on
    // player_id — the latter multiplies rows for players with >1 currency wallet.
    const { rows } = await pool.query<{
      player_name: string | null; game: string; multiplier: string
      winnings: string; currency: string; won_at: string
    }>(
      `SELECT p.name AS player_name, b.game_type AS game,
              b.cashout_multiplier AS multiplier, b.winnings, w.currency, b.settled_at AS won_at
       FROM bets b
       JOIN players p ON p.id = b.player_id
       JOIN wallets w ON w.id = b.wallet_id
       WHERE b.status = 'won' AND b.winnings IS NOT NULL
       ORDER BY b.settled_at DESC LIMIT 10`,
    )
    return reply.send(rows.map(r => ({
      playerName: maskName(r.player_name),
      game: r.game,
      multiplier: Number(r.multiplier),
      winnings: Number(r.winnings),
      currency: r.currency,
      wonAt: r.won_at,
    })))
  })
}
