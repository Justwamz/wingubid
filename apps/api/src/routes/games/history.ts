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

  // Combined history across every game (bets + scratch cards + lottery tickets),
  // normalized to a single shape for the "My Bets" page.
  app.get('/games/history/all', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT id::text AS id, game_type::text AS game, gross_stake AS stake,
              cashout_multiplier AS multiplier, COALESCE(winnings, 0) AS payout,
              status::text AS status, created_at, fund_source::varchar AS fund_source
         FROM bets WHERE player_id = $1
       UNION ALL
       SELECT id::text, 'scratch', stake_cents, NULL::numeric,
              COALESCE(net_credited_cents, prize_cents),
              CASE WHEN prize_cents > 0 THEN 'won' ELSE 'lost' END, created_at, fund_source::varchar
         FROM scratch_cards WHERE player_id = $1
       UNION ALL
       SELECT id::text, 'lotto', ticket_price, NULL::numeric,
              COALESCE(prize_cents, 0), status::text, created_at, 'cash'::varchar
         FROM lottery_tickets WHERE player_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.playerId],
    )
    return reply.send(rows.map(r => ({
      id: r.id,
      game: r.game,
      stake: Number(r.stake),
      multiplier: r.multiplier != null ? Number(r.multiplier) : null,
      payout: Number(r.payout),
      status: r.status,
      createdAt: r.created_at,
      fundSource: r.fund_source,
    })))
  })
}
