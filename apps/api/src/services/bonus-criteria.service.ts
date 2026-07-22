import { z } from 'zod'
import { pool } from '@betting/db'

export interface Criteria {
  registeredWithinDays?: number
  depositStatus?: 'has' | 'none'
  minTotalDepositCents?: number
  bettingActivity?: 'has' | 'none'
}

export const criteriaSchema = z.object({
  registeredWithinDays: z.number().int().min(1).max(3650).optional(),
  depositStatus: z.enum(['has', 'none']).optional(),
  minTotalDepositCents: z.number().int().min(1).optional(),
  bettingActivity: z.enum(['has', 'none']).optional(),
}).strict()

// Turn criteria into a parameterized WHERE fragment over players (alias `pl`).
// Empty/null -> 'TRUE'. Reused for the per-player check and the admin count.
export function buildCriteria(criteria: Criteria | null | undefined): { where: string; params: unknown[] } {
  const conds: string[] = []
  const params: unknown[] = []
  const p = (v: unknown) => { params.push(v); return `$${params.length}` }
  if (criteria) {
    if (criteria.registeredWithinDays != null) {
      conds.push(`pl.created_at >= NOW() - make_interval(days => ${p(criteria.registeredWithinDays)})`)
    }
    if (criteria.depositStatus === 'has') {
      conds.push(`EXISTS (SELECT 1 FROM transactions t WHERE t.player_id = pl.id AND t.type = 'deposit' AND t.status = 'completed')`)
    } else if (criteria.depositStatus === 'none') {
      conds.push(`NOT EXISTS (SELECT 1 FROM transactions t WHERE t.player_id = pl.id AND t.type = 'deposit' AND t.status = 'completed')`)
    }
    if (criteria.minTotalDepositCents != null) {
      conds.push(`(SELECT COALESCE(SUM(amount), 0) FROM transactions t WHERE t.player_id = pl.id AND t.type = 'deposit' AND t.status = 'completed') >= ${p(criteria.minTotalDepositCents)}`)
    }
    if (criteria.bettingActivity === 'has') {
      conds.push(`EXISTS (SELECT 1 FROM bets b WHERE b.player_id = pl.id)`)
    } else if (criteria.bettingActivity === 'none') {
      conds.push(`NOT EXISTS (SELECT 1 FROM bets b WHERE b.player_id = pl.id)`)
    }
  }
  return { where: conds.length ? conds.join(' AND ') : 'TRUE', params }
}

export async function playerMatchesCriteria(playerId: string, criteria: Criteria | null | undefined): Promise<boolean> {
  const { where, params } = buildCriteria(criteria)
  if (where === 'TRUE') return true
  params.push(playerId)
  const { rows } = await pool.query<{ m: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM players pl WHERE (${where}) AND pl.id = $${params.length}) AS m`,
    params,
  )
  return rows[0].m
}

export async function countMatchingPlayers(criteria: Criteria | null | undefined): Promise<number> {
  const { where, params } = buildCriteria(criteria)
  const { rows } = await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM players pl WHERE (${where})`, params)
  return Number(rows[0].n)
}
