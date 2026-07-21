import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'

// The leaderboard is public, so never expose full player names (PII). Prefer the
// player's chosen public chat username; otherwise show a masked first initial.
function maskName(name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? ''
  if (first.length <= 1) return first ? `${first}•••` : 'Player'
  return first[0] + '•'.repeat(Math.min(first.length - 1, 4))
}
function displayName(username: string | null, name: string | null): string {
  return username && username.trim() ? username : maskName(name)
}

let presenceCache: { players: number; at: number } | null = null
const PRESENCE_TTL = 30_000

export async function gameLeaderboardRoutes(app: FastifyInstance) {
  app.get('/games/leaderboard', async (_req, reply) => {
    // Recent real wins across every game (bets + scratch + lottery), newest first.
    const { rows } = await pool.query<{
      uname: string | null; pname: string | null; game: string
      multiplier: string | null; winnings: string; currency: string; won_at: string
    }>(
      `SELECT uname, pname, game, multiplier, winnings, currency, won_at FROM (
         SELECT p.chat_username AS uname, p.name AS pname, b.game_type AS game,
                b.cashout_multiplier AS multiplier, b.winnings AS winnings,
                p.currency AS currency, b.settled_at AS won_at
         FROM bets b JOIN players p ON p.id = b.player_id
         WHERE b.status = 'won' AND b.winnings IS NOT NULL
         UNION ALL
         SELECT p.chat_username, p.name, 'scratch', NULL::numeric, sc.prize_cents,
                p.currency, sc.created_at
         FROM scratch_cards sc JOIN players p ON p.id = sc.player_id
         WHERE sc.prize_cents > 0
         UNION ALL
         SELECT p.chat_username, p.name, 'lottery', NULL::numeric, lt.prize_cents,
                p.currency, lt.created_at
         FROM lottery_tickets lt JOIN players p ON p.id = lt.player_id
         WHERE lt.status = 'won' AND lt.prize_cents > 0
       ) w
       ORDER BY won_at DESC LIMIT 15`,
    )

    const { rows: agg } = await pool.query<{ total: string; winners: string; cnt: string }>(
      `WITH wins AS (
         SELECT b.player_id AS pid, b.winnings AS amt, b.settled_at AS t FROM bets b WHERE b.status = 'won' AND b.winnings IS NOT NULL
         UNION ALL SELECT sc.player_id, sc.prize_cents, sc.created_at FROM scratch_cards sc WHERE sc.prize_cents > 0
         UNION ALL SELECT lt.player_id, lt.prize_cents, lt.created_at FROM lottery_tickets lt WHERE lt.status = 'won' AND lt.prize_cents > 0
       )
       SELECT COALESCE(SUM(amt),0) AS total, COUNT(DISTINCT pid) AS winners, COUNT(*) AS cnt
       FROM wins WHERE t >= (CURRENT_DATE AT TIME ZONE 'Africa/Nairobi')`,
    )

    return reply.send({
      wins: rows.map(r => ({
        name: displayName(r.uname, r.pname),
        game: r.game,
        multiplier: r.multiplier != null ? Number(r.multiplier) : null,
        winnings: Number(r.winnings),
        currency: r.currency,
        wonAt: r.won_at,
      })),
      today: {
        totalWon: Number(agg[0].total),
        winners: Number(agg[0].winners),
        count: Number(agg[0].cnt),
      },
    })
  })

  // Distinct players who placed any bet in the last 15 minutes - a truthful,
  // platform-wide "active now" number (cached ~30s).
  app.get('/games/presence', async (_req, reply) => {
    if (presenceCache && Date.now() - presenceCache.at < PRESENCE_TTL) {
      return reply.send({ players: presenceCache.players, windowMinutes: 15 })
    }
    const { rows } = await pool.query<{ n: string }>(
      `SELECT COUNT(DISTINCT pid) AS n FROM (
         SELECT player_id AS pid FROM bets WHERE created_at >= NOW() - INTERVAL '15 minutes'
         UNION SELECT player_id FROM scratch_cards WHERE created_at >= NOW() - INTERVAL '15 minutes'
         UNION SELECT player_id FROM lottery_tickets WHERE created_at >= NOW() - INTERVAL '15 minutes'
       ) x`,
    )
    const players = Number(rows[0].n)
    presenceCache = { players, at: Date.now() }
    return reply.send({ players, windowMinutes: 15 })
  })
}
