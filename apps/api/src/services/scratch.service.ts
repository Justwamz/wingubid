import { createHmac } from 'crypto'
import { pool } from '@betting/db'
import { debitForBet, creditWinnings } from './wallet.service.js'
import { nextScratchRoll } from './scratch-seed.service.js'
import { AppError } from '../lib/errors.js'

export const SYMBOLS_EMOJI = ['💎', '🌟', '🍀', '🔥', '💰', '❌']

// Cumulative weights summing to 100: 💎=2, 🌟=5, 🍀=8, 🔥=13, 💰=13, ❌=59.
// Tuned together with the multipliers below to a ~24% house edge (RTP ~76%);
// the common 🔥/💰 symbols are the dominant lever, so they sit at 13% each.
export const CUMULATIVE_WEIGHTS = [2, 7, 15, 28, 41, 100]

// Multipliers: [symbol][matchCount] - matchCount clamped to 5. Scaled down from
// the original table (which paid out ~232% RTP - a house loss) to a ~24% edge.
export const PRIZE_MULTIPLIERS: Record<number, Record<number, number>> = {
  0: { 3: 19,  4: 57,  5: 190 }, // 💎
  1: { 3: 8,   4: 23,  5: 76  }, // 🌟
  2: { 3: 4,   4: 11,  5: 38  }, // 🍀
  3: { 3: 2,   4: 4,   5: 11  }, // 🔥
  4: { 3: 2,   4: 4,   5: 11  }, // 💰
}

function symbolForByte(byte: number): number | null {
  // Reject bytes >= 200 to avoid modulo bias (200 = 2×100)
  if (byte >= 200) return null
  const val = byte % 100
  for (let i = 0; i < CUMULATIVE_WEIGHTS.length; i++) {
    if (val < CUMULATIVE_WEIGHTS[i]) return i
  }
  return null
}

/**
 * Deterministically derive the 9-cell grid from the committed seed, so a player
 * can reproduce (and thus verify) their card after the server seed is revealed.
 * Bytes are drawn from HMAC(serverSeed, `${clientSeed}-${nonce}-${counter}`),
 * with the same modulo-bias rejection as before.
 */
export function generateGridFromSeed(serverSeed: string, clientSeed: string, nonce: number): number[] {
  const grid: number[] = []
  let counter = 0
  while (grid.length < 9) {
    const digest = createHmac('sha256', serverSeed)
      .update(`${clientSeed}-${nonce}-${counter}`)
      .digest()
    for (const byte of digest) {
      if (grid.length >= 9) break
      const sym = symbolForByte(byte)
      if (sym !== null) grid.push(sym)
    }
    counter++
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
): Promise<{
  cardId: string; grid: number[]; prizeCents: number
  serverSeedHash: string; clientSeed: string; nonce: number
}> {
  if (!VALID_STAKES.has(stakeCents)) {
    throw new AppError('INVALID_STAKE', 'Please choose a stake of KES 20, 50, 100, or 200.', 400)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Provably fair: the server seed's hash was committed before this purchase
    // and is revealed only on rotation; the grid is derived deterministically
    // from the seed + atomically-claimed nonce so the player can verify it.
    const { serverSeed, serverSeedHash, clientSeed, nonce } = await nextScratchRoll(client, playerId)
    const grid = generateGridFromSeed(serverSeed, clientSeed, nonce)
    const prizeCents = calculatePrize(grid, stakeCents)

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
    return { cardId, grid, prizeCents, serverSeedHash, clientSeed, nonce }
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
