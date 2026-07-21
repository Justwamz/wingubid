import { pool } from '@betting/db'
import { getGameOrderConfig } from './game-settings.service.js'

export type OrderGame = 'crash' | 'mines' | 'dice' | 'scratch' | 'lottery'
export const ORDER_GAMES: OrderGame[] = ['crash', 'mines', 'dice', 'scratch', 'lottery']

export interface GameStat { staked: number; paid: number }
export interface RankOpts { revenueWeight: number; minStake: number }

// Pure ranking: given per-game stakes/payouts, return the games (that meet the
// minimum volume) ordered highest-score first. Score blends house revenue
// (stakes - payouts) and activity (stakes), each min-max normalized across the
// ranked games so negative-revenue games still sort sensibly.
export function rankGames(stats: Record<OrderGame, GameStat>, opts: RankOpts): OrderGame[] {
  const games = ORDER_GAMES.filter(g => stats[g] && stats[g].staked >= opts.minStake)
  if (games.length <= 1) return games

  const revenueWeight = Math.min(1, Math.max(0, opts.revenueWeight))
  const activityWeight = 1 - revenueWeight
  const revOf = (g: OrderGame) => stats[g].staked - stats[g].paid
  const revs = games.map(revOf)
  const minRev = Math.min(...revs), maxRev = Math.max(...revs)
  const maxAct = Math.max(...games.map(g => stats[g].staked))
  const norm = (v: number, min: number, max: number) => (max > min ? (v - min) / (max - min) : 0)
  const score = (g: OrderGame) =>
    revenueWeight * norm(revOf(g), minRev, maxRev) +
    activityWeight * (maxAct > 0 ? stats[g].staked / maxAct : 0)

  return [...games].sort((a, b) => score(b) - score(a))
}

async function fetchStats(windowDays: number): Promise<Record<OrderGame, GameStat>> {
  const out = Object.fromEntries(ORDER_GAMES.map(g => [g, { staked: 0, paid: 0 }])) as Record<OrderGame, GameStat>
  const win = String(windowDays)

  const { rows: bets } = await pool.query<{ game_type: string; staked: string; paid: string }>(
    `SELECT game_type, SUM(gross_stake) AS staked, SUM(COALESCE(winnings,0)) AS paid
     FROM bets WHERE status IN ('won','lost') AND game_type IN ('crash','mines','dice')
       AND settled_at >= NOW() - ($1 || ' days')::interval
     GROUP BY game_type`,
    [win],
  )
  for (const r of bets) out[r.game_type as OrderGame] = { staked: Number(r.staked), paid: Number(r.paid) }

  const { rows: sc } = await pool.query<{ staked: string | null; paid: string | null }>(
    `SELECT SUM(stake_cents) AS staked, SUM(prize_cents) AS paid FROM scratch_cards
     WHERE created_at >= NOW() - ($1 || ' days')::interval`,
    [win],
  )
  out.scratch = { staked: Number(sc[0]?.staked ?? 0), paid: Number(sc[0]?.paid ?? 0) }

  const { rows: lt } = await pool.query<{ staked: string | null; paid: string | null }>(
    `SELECT SUM(ticket_price) AS staked, SUM(prize_cents) AS paid FROM lottery_tickets
     WHERE status IN ('won','lost') AND created_at >= NOW() - ($1 || ' days')::interval`,
    [win],
  )
  out.lottery = { staked: Number(lt[0]?.staked ?? 0), paid: Number(lt[0]?.paid ?? 0) }

  return out
}

let cache: { order: OrderGame[]; at: number } | null = null
const TTL_MS = 5 * 60 * 1000

export function invalidateGameOrderCache(): void {
  cache = null
}

// Ranked game order for the lobby, cached ~5 min. Returns [] when there isn't
// enough data to rank anything (client then keeps its default order).
export async function getGameOrder(): Promise<OrderGame[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.order
  const cfg = await getGameOrderConfig()
  const order = rankGames(await fetchStats(cfg.windowDays), cfg)
  cache = { order, at: Date.now() }
  return order
}
