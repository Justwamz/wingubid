import { randomBytes, createHmac } from 'crypto'
import { pool } from '@betting/db'
import { debitForBet, creditWinnings } from './wallet.service.js'
import { AppError } from '../lib/errors.js'

export const TICKET_PRICES: Record<string, number> = {
  hourly: 2000,   // KES 20
  daily:  10000,  // KES 100
  weekly: 50000,  // KES 500
}

export const PRIZE_MULTIPLIERS: Record<string, Record<number, number>> = {
  hourly: { 3: 100, 2: 5,  1: 1, 0: 0 },
  daily:  { 3: 300, 2: 8,  1: 1, 0: 0 },
  weekly: { 3: 1000, 2: 15, 1: 1, 0: 0 },
}

// Number pool players pick from (3 distinct numbers of 1..36). Used to derive
// the fixed match odds for the read-only margin readout.
export const LOTTERY_POOL = 36
export const LOTTERY_PICK = 3

export function draw3Numbers(): number[] {
  const numbers = new Set<number>()
  while (numbers.size < 3) {
    const bytes = randomBytes(4)
    const val = bytes.readUInt32BE(0)
    // Reject values above floor(2^32/36)*36 to avoid modulo bias
    const max = Math.floor(0xffffffff / 36) * 36
    if (val <= max) numbers.add((val % 36) + 1)
  }
  return [...numbers].sort((a, b) => a - b)
}

/**
 * Deterministically derive the 3 winning numbers from a draw's server seed, so
 * a player can reproduce (and thus verify) the result once the seed is revealed.
 * Same modulo-bias rejection as draw3Numbers, drawing 4-byte words from
 * HMAC(serverSeed, `draw-<counter>`).
 */
export function draw3NumbersFromSeed(serverSeed: string): number[] {
  const numbers = new Set<number>()
  const max = Math.floor(0xffffffff / 36) * 36
  let counter = 0
  while (numbers.size < 3) {
    const digest = createHmac('sha256', serverSeed).update(`draw-${counter}`).digest()
    for (let off = 0; off + 4 <= digest.length && numbers.size < 3; off += 4) {
      const val = digest.readUInt32BE(off)
      if (val <= max) numbers.add((val % 36) + 1)
    }
    counter++
  }
  return [...numbers].sort((a, b) => a - b)
}

export function countMatches(winningNumbers: number[], pickedNumbers: number[]): number {
  return pickedNumbers.filter(n => winningNumbers.includes(n)).length
}

export function calculateLotteryPrize(
  drawType: string,
  matchedCount: number,
  ticketPrice: number,
): number {
  const mult = PRIZE_MULTIPLIERS[drawType]?.[matchedCount] ?? 0
  return ticketPrice * mult
}

export async function buyTicket(
  playerId: string,
  drawType: string,
  pickedNumbers: number[],
): Promise<{ ticketId: string; drawId: string; scheduledAt: string; ticketPrice: number }> {
  if (!['hourly', 'daily', 'weekly'].includes(drawType)) {
    throw new AppError('INVALID_DRAW_TYPE', "That lottery draw isn't available.", 400)
  }
  if (pickedNumbers.length !== 3) {
    throw new AppError('INVALID_NUMBERS', 'Please pick exactly 3 numbers.', 400)
  }
  if (pickedNumbers.some(n => n < 1 || n > 36 || !Number.isInteger(n))) {
    throw new AppError('INVALID_NUMBERS', 'Your numbers must be whole numbers between 1 and 36.', 400)
  }
  if (new Set(pickedNumbers).size !== 3) {
    throw new AppError('INVALID_NUMBERS', 'Your 3 numbers must all be different.', 400)
  }

  const { rows: drawRows } = await pool.query<{ id: string; scheduled_at: string; ticket_price: string }>(
    `SELECT id, scheduled_at, ticket_price FROM lottery_draws
     WHERE draw_type = $1 AND status = 'pending' AND scheduled_at > NOW()
     ORDER BY scheduled_at ASC LIMIT 1`,
    [drawType],
  )

  if (drawRows.length === 0) {
    throw new AppError('DRAW_NOT_FOUND', "There's no upcoming draw for this game right now. Please check back soon.", 404)
  }

  const draw = drawRows[0]
  const ticketPrice = Number(draw.ticket_price)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { walletId } = await debitForBet(client, playerId, ticketPrice, ticketPrice, {
      game: 'lottery', drawType, drawId: draw.id,
    })

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO lottery_tickets (player_id, wallet_id, draw_id, picked_numbers, ticket_price)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [playerId, walletId, draw.id, pickedNumbers, ticketPrice],
    )

    await client.query('COMMIT')
    return { ticketId: rows[0].id, drawId: draw.id, scheduledAt: draw.scheduled_at, ticketPrice }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function settleTickets(drawId: string, drawType: string, winningNumbers: number[]): Promise<void> {
  const { rows: tickets } = await pool.query<{
    id: string; player_id: string; wallet_id: string; picked_numbers: number[]; ticket_price: string
  }>(
    `SELECT id, player_id, wallet_id, picked_numbers, ticket_price
     FROM lottery_tickets WHERE draw_id = $1 AND status = 'pending'`,
    [drawId],
  )

  // Settle the whole draw on ONE pooled connection. Previously this opened a
  // new pool.connect() per ticket, so a popular draw could exhaust the pool and
  // starve every other request. Each ticket still runs in its own transaction
  // on the shared connection, so one bad ticket doesn't roll back the rest.
  const client = await pool.connect()
  try {
    for (const ticket of tickets) {
      const ticketPrice = Number(ticket.ticket_price)
      const matched = countMatches(winningNumbers, ticket.picked_numbers)
      const prizeCents = calculateLotteryPrize(drawType, matched, ticketPrice)
      const status = prizeCents > 0 ? 'won' : 'lost'

      try {
        await client.query('BEGIN')
        // Atomically claim the ticket: only settle if it is still pending. If a
        // concurrent/re-fired settlement (restart, double-fire, >1 instance)
        // already settled it, 0 rows come back and we skip the credit - this
        // makes settlement idempotent and prevents double payouts.
        const { rowCount } = await client.query(
          `UPDATE lottery_tickets SET matched_count = $1, prize_cents = $2, status = $3
           WHERE id = $4 AND status = 'pending'`,
          [matched, prizeCents, status, ticket.id],
        )
        if (rowCount === 0) {
          await client.query('COMMIT')
          continue
        }
        // Release the stake reserved at buy time (buyTicket locks it). This runs
        // for every claimed ticket - won or lost - to keep locked_balance accurate.
        await client.query(
          `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
          [ticketPrice, ticket.player_id],
        )
        if (prizeCents > 0) {
          await creditWinnings(client, ticket.player_id, prizeCents, {
            game: 'lottery', drawId, ticketId: ticket.id, matched,
          })
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        console.error('[lottery] settle ticket error', ticket.id, err)
      }
    }
  } finally {
    client.release()
  }
}

export async function getUpcomingDraws(): Promise<{
  id: string; drawType: string; ticketPrice: number; scheduledAt: string; jackpot: number
  serverSeedHash: string | null
}[]> {
  const { rows } = await pool.query<{
    id: string; draw_type: string; ticket_price: string; scheduled_at: string
    server_seed_hash: string | null
  }>(
    `SELECT DISTINCT ON (draw_type) id, draw_type, ticket_price, scheduled_at, server_seed_hash
     FROM lottery_draws WHERE status = 'pending' AND scheduled_at > NOW()
     ORDER BY draw_type, scheduled_at ASC`,
  )
  return rows.map(r => {
    const ticketPrice = Number(r.ticket_price)
    const mult = PRIZE_MULTIPLIERS[r.draw_type]?.[3] ?? 0
    return {
      id: r.id,
      drawType: r.draw_type,
      ticketPrice,
      scheduledAt: r.scheduled_at,
      jackpot: ticketPrice * mult,
      // Committed before any ticket is sold; the raw seed is revealed only
      // after the draw (see getPlayerTickets).
      serverSeedHash: r.server_seed_hash,
    }
  })
}

export async function getPlayerTickets(playerId: string): Promise<{
  id: string; drawType: string; pickedNumbers: number[]; ticketPrice: number
  matchedCount: number | null; prizeCents: number; status: string
  scheduledAt: string; winningNumbers: number[] | null; createdAt: string
  serverSeedHash: string | null; serverSeed: string | null
}[]> {
  const { rows } = await pool.query<{
    id: string; draw_type: string; picked_numbers: number[]; ticket_price: string
    matched_count: number | null; prize_cents: string; status: string
    scheduled_at: string; winning_numbers: number[] | null; created_at: string
    server_seed_hash: string | null; server_seed: string | null
  }>(
    `SELECT t.id, d.draw_type, t.picked_numbers, t.ticket_price,
            t.matched_count, t.prize_cents, t.status,
            d.scheduled_at, d.winning_numbers, t.created_at,
            d.server_seed_hash,
            -- Reveal the raw seed only once the draw is complete, so it can't
            -- be used to predict a pending draw.
            CASE WHEN d.status = 'completed' THEN d.server_seed ELSE NULL END AS server_seed
     FROM lottery_tickets t
     JOIN lottery_draws d ON d.id = t.draw_id
     WHERE t.player_id = $1
     ORDER BY t.created_at DESC LIMIT 50`,
    [playerId],
  )
  return rows.map(r => ({
    id: r.id,
    drawType: r.draw_type,
    pickedNumbers: r.picked_numbers,
    ticketPrice: Number(r.ticket_price),
    matchedCount: r.matched_count,
    prizeCents: Number(r.prize_cents),
    status: r.status,
    scheduledAt: r.scheduled_at,
    winningNumbers: r.winning_numbers,
    createdAt: r.created_at,
    serverSeedHash: r.server_seed_hash,
    serverSeed: r.server_seed,
  }))
}
