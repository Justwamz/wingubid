import { randomBytes } from 'crypto'
import { pool } from '@betting/db'
import { debitForBet, creditWinnings } from './wallet.service.js'
import { AppError } from '../lib/errors.js'

export const SYMBOLS_EMOJI = ['💎', '🌟', '🍀', '🔥', '💰', '❌']

// Cumulative weights summing to 100: 💎=2, 🌟=5, 🍀=8, 🔥=15, 💰=15, ❌=55
const CUMULATIVE_WEIGHTS = [2, 7, 15, 30, 45, 100]

// Multipliers: [symbol][matchCount] — matchCount clamped to 5
const PRIZE_MULTIPLIERS: Record<number, Record<number, number>> = {
  0: { 3: 50,  4: 150, 5: 500 }, // 💎
  1: { 3: 20,  4: 60,  5: 200 }, // 🌟
  2: { 3: 10,  4: 30,  5: 100 }, // 🍀
  3: { 3: 4,   4: 10,  5: 30  }, // 🔥
  4: { 3: 4,   4: 10,  5: 30  }, // 💰
}

export function generateGrid(): number[] {
  const grid: number[] = []
  while (grid.length < 9) {
    const byte = randomBytes(1)[0]
    // Reject bytes >= 200 to avoid modulo bias (200 = 2×100)
    if (byte >= 200) continue
    const val = byte % 100
    for (let i = 0; i < CUMULATIVE_WEIGHTS.length; i++) {
      if (val < CUMULATIVE_WEIGHTS[i]) {
        grid.push(i)
        break
      }
    }
  }
  return grid
}

export function calculatePrize(grid: number[], stakeCents: number): number {
  const counts = new Map<number, number>()
  for (const cell of grid) {
    if (cell < 5) counts.set(cell, (counts.get(cell) ?? 0) + 1) // skip ❌ (5)
  }
  let best = 0
  for (const [symbol, count] of counts) {
    if (count < 3) continue
    const clampedCount = Math.min(count, 5) as 3 | 4 | 5
    const mult = PRIZE_MULTIPLIERS[symbol]?.[clampedCount] ?? 0
    const prize = stakeCents * mult
    if (prize > best) best = prize
  }
  return best
}

const VALID_STAKES = new Set([2000, 5000, 10000, 20000])

export async function buyScratchCard(
  playerId: string,
  stakeCents: number,
): Promise<{ cardId: string; grid: number[]; prizeCents: number }> {
  if (!VALID_STAKES.has(stakeCents)) {
    throw new AppError('INVALID_STAKE', 'Stake must be 2000, 5000, 10000, or 20000 cents', 400)
  }

  const grid = generateGrid()
  const prizeCents = calculatePrize(grid, stakeCents)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { walletId } = await debitForBet(client, playerId, stakeCents, stakeCents, { game: 'scratch' }, { lock: false })

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO scratch_cards (player_id, wallet_id, stake_cents, grid, prize_cents, status)
       VALUES ($1, $2, $3, $4, $5, 'completed') RETURNING id`,
      [playerId, walletId, stakeCents, grid, prizeCents],
    )
    const cardId = rows[0].id

    if (prizeCents > 0) {
      await creditWinnings(client, playerId, prizeCents, { game: 'scratch', cardId })
    }

    await client.query('COMMIT')
    return { cardId, grid, prizeCents }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getScratchHistory(playerId: string): Promise<{
  id: string; stakeCents: number; grid: number[]; prizeCents: number; createdAt: string
}[]> {
  const { rows } = await pool.query<{
    id: string; stake_cents: string; grid: number[]; prize_cents: string; created_at: string
  }>(
    `SELECT id, stake_cents, grid, prize_cents, created_at
     FROM scratch_cards WHERE player_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [playerId],
  )
  return rows.map(r => ({
    id: r.id,
    stakeCents: Number(r.stake_cents),
    grid: r.grid,
    prizeCents: Number(r.prize_cents),
    createdAt: r.created_at,
  }))
}
