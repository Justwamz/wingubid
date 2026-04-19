# Lottery Games + Promotions Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Pick-3 lottery (hourly/daily/weekly draws), instant scratch card game, and admin-configurable promotion banners on the landing page and games lobby.

**Architecture:** Lottery scheduler runs as an async loop started in `index.ts` alongside the existing Crash loop. Scratch cards are resolved server-side instantly in a single DB transaction. Banners use a `placement` column (`landing`|`lobby`) so one admin Promotions tab manages both. All games reuse existing `debitForBet`/`creditWinnings` wallet services and flow through the `transactions` table.

**Tech Stack:** Fastify 4, PostgreSQL (`@betting/db` pool), `crypto.randomBytes` for RNG, Next.js 14, Vitest, Tailwind CSS.

---

## File Map

**Create:**
- `packages/db/migrations/014_lottery_banners.sql` — all 4 new tables + 2 seed banners
- `apps/api/src/services/scratch.service.ts` — grid generation, prize calc, buy flow
- `apps/api/src/services/scratch.service.test.ts` — unit tests
- `apps/api/src/services/lottery.service.ts` — buy ticket, settle tickets, get draws, get player tickets
- `apps/api/src/services/lottery.service.test.ts` — unit tests
- `apps/api/src/game/lottery-loop.ts` — scheduler loop for all 3 draw tiers
- `apps/api/src/routes/games/scratch.ts` — POST /games/scratch/buy, GET /games/scratch/history
- `apps/api/src/routes/games/lottery.ts` — GET /games/lottery/draws, POST /games/lottery/tickets, GET /games/lottery/tickets/mine
- `apps/api/src/routes/banners/public.ts` — GET /banners/landing, GET /banners/lobby
- `apps/api/src/routes/admin/banners.ts` — admin CRUD + activate
- `apps/web/src/app/(player)/games/scratch/page.tsx` — scratch card game UI
- `apps/web/src/app/(player)/games/lottery/page.tsx` — draw lottery UI with countdown timers

**Modify:**
- `apps/api/src/server.ts` — register 4 new route modules
- `apps/api/src/index.ts` — call `startLotteryLoop()`
- `apps/web/src/app/(player)/games/page.tsx` — add LOTTO + SCRATCH cards, fetch + render lobby banner
- `apps/web/src/app/page.tsx` — fetch + render landing banner
- `apps/admin/src/app/dashboard/page.tsx` — add Promotions tab (Landing + Lobby sub-sections)

---

## Task 1: DB Migration

**Files:**
- Create: `packages/db/migrations/014_lottery_banners.sql`

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/migrations/014_lottery_banners.sql

CREATE TABLE lottery_draws (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_type       VARCHAR(10) NOT NULL CHECK (draw_type IN ('hourly','daily','weekly')),
  ticket_price    BIGINT NOT NULL,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  drawn_at        TIMESTAMPTZ,
  winning_numbers INT[],
  status          VARCHAR(10) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','completed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lottery_draws_type_status ON lottery_draws(draw_type, status);
CREATE INDEX idx_lottery_draws_scheduled_at ON lottery_draws(scheduled_at);

CREATE TABLE lottery_tickets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID NOT NULL REFERENCES players(id),
  wallet_id      UUID NOT NULL REFERENCES wallets(id),
  draw_id        UUID NOT NULL REFERENCES lottery_draws(id),
  picked_numbers INT[] NOT NULL,
  ticket_price   BIGINT NOT NULL,
  matched_count  INT,
  prize_cents    BIGINT NOT NULL DEFAULT 0,
  status         VARCHAR(10) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','won','lost')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lottery_tickets_player_id ON lottery_tickets(player_id);
CREATE INDEX idx_lottery_tickets_draw_id ON lottery_tickets(draw_id);

CREATE TABLE scratch_cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID NOT NULL REFERENCES players(id),
  wallet_id   UUID NOT NULL REFERENCES wallets(id),
  stake_cents BIGINT NOT NULL,
  grid        INT[] NOT NULL,
  prize_cents BIGINT NOT NULL DEFAULT 0,
  status      VARCHAR(10) NOT NULL DEFAULT 'completed',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_scratch_cards_player_id ON scratch_cards(player_id);

CREATE TABLE banners (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  placement VARCHAR(10)  NOT NULL CHECK (placement IN ('landing','lobby')),
  headline  VARCHAR(80)  NOT NULL,
  subtext   VARCHAR(160) NOT NULL DEFAULT '',
  cta_text  VARCHAR(40)  NOT NULL DEFAULT '',
  cta_url   VARCHAR(255) NOT NULL DEFAULT '/wallet/deposit',
  image_url VARCHAR(500) NOT NULL DEFAULT '',
  gradient  VARCHAR(100) NOT NULL DEFAULT 'from-cyan-900/60 to-violet-900/40',
  active    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_banners_placement_active ON banners(placement, active);

-- Seed demo banners
INSERT INTO banners (placement, headline, subtext, cta_text, cta_url, gradient, active) VALUES
(
  'landing',
  '🎉 Register Free — Start with KES 10,000',
  'No deposit needed. Create your account and play Crash, Mines, Dice, Lotto and Scratch instantly.',
  'Create Free Account',
  '/register',
  'from-cyan-900/60 to-violet-900/40',
  true
),
(
  'lobby',
  '💰 Deposit & Play — Double Your First Top-Up',
  'Add KES 500 or more and we match it. Play Crash, Mines, Dice, Lotto and Scratch.',
  'Top Up Now',
  '/wallet/deposit',
  'from-violet-900/60 to-cyan-900/40',
  true
);
```

- [ ] **Step 2: Verify migration will be picked up**

The project uses `runMigrations()` from `@betting/db` on startup which runs all SQL files in `packages/db/migrations/` alphabetically. `014_lottery_banners.sql` will run after `013_admin_seed.sql`. No manual action needed.

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/014_lottery_banners.sql
git commit -m "feat(db): add lottery draws, tickets, scratch cards, banners tables"
```

---

## Task 2: Scratch Card Service

**Files:**
- Create: `apps/api/src/services/scratch.service.ts`
- Create: `apps/api/src/services/scratch.service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/services/scratch.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateGrid, calculatePrize, SYMBOLS_EMOJI } from './scratch.service.js'

beforeEach(() => vi.clearAllMocks())

describe('generateGrid', () => {
  it('returns exactly 9 cells', () => {
    const grid = generateGrid()
    expect(grid).toHaveLength(9)
  })

  it('all cells are valid symbol indices 0-5', () => {
    const grid = generateGrid()
    for (const cell of grid) {
      expect(cell).toBeGreaterThanOrEqual(0)
      expect(cell).toBeLessThanOrEqual(5)
    }
  })
})

describe('calculatePrize', () => {
  it('returns 0 when no symbol appears 3+ times', () => {
    // 9 cells, all different or only 2 of same
    const grid = [0, 1, 2, 3, 4, 5, 0, 1, 2] // max 2 of same
    expect(calculatePrize(grid, 10000)).toBe(0)
  })

  it('returns stake * 50 for 3 matching 💎 (symbol 0)', () => {
    const grid = [0, 0, 0, 1, 2, 3, 4, 5, 5]
    expect(calculatePrize(grid, 10000)).toBe(10000 * 50)
  })

  it('returns stake * 150 for 4 matching 💎 (symbol 0)', () => {
    const grid = [0, 0, 0, 0, 1, 2, 3, 4, 5]
    expect(calculatePrize(grid, 10000)).toBe(10000 * 150)
  })

  it('returns stake * 500 for 5 matching 💎 (symbol 0)', () => {
    const grid = [0, 0, 0, 0, 0, 1, 2, 3, 4]
    expect(calculatePrize(grid, 10000)).toBe(10000 * 500)
  })

  it('returns stake * 4 for 3 matching 🔥 (symbol 3)', () => {
    const grid = [3, 3, 3, 0, 1, 2, 4, 5, 5]
    expect(calculatePrize(grid, 5000)).toBe(5000 * 4)
  })

  it('returns 0 when only ❌ matches 3+', () => {
    const grid = [5, 5, 5, 0, 1, 2, 3, 4, 1]
    expect(calculatePrize(grid, 10000)).toBe(0)
  })

  it('returns best prize when multiple symbols match 3+', () => {
    // 3x 💎 (×50) and 3x 🔥 (×4) — should return 💎 prize
    const grid = [0, 0, 0, 3, 3, 3, 1, 2, 4]
    expect(calculatePrize(grid, 10000)).toBe(10000 * 50)
  })
})

describe('SYMBOLS_EMOJI', () => {
  it('has 6 entries', () => {
    expect(SYMBOLS_EMOJI).toHaveLength(6)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm vitest run src/services/scratch.service.test.ts
```
Expected: FAIL — `Cannot find module './scratch.service.js'`

- [ ] **Step 3: Implement the scratch card service**

```typescript
// apps/api/src/services/scratch.service.ts
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
    const { walletId } = await debitForBet(client, playerId, stakeCents, stakeCents, { game: 'scratch' })

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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm vitest run src/services/scratch.service.test.ts
```
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/scratch.service.ts apps/api/src/services/scratch.service.test.ts
git commit -m "feat(scratch): add scratch card service with RNG and prize calculation"
```

---

## Task 3: Scratch Card API Routes

**Files:**
- Create: `apps/api/src/routes/games/scratch.ts`

- [ ] **Step 1: Create the route file**

```typescript
// apps/api/src/routes/games/scratch.ts
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { buyScratchCard, getScratchHistory } from '../../services/scratch.service.js'
import { AppError } from '../../lib/errors.js'

const buyBody = z.object({
  stake: z.number().int().positive(),
})

export async function scratchRoutes(app: FastifyInstance) {
  app.post('/games/scratch/buy', { preHandler: authenticate }, async (req, reply) => {
    const parsed = buyBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }
    try {
      const result = await buyScratchCard(req.playerId, parsed.data.stake)
      return reply.send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  app.get('/games/scratch/history', { preHandler: authenticate }, async (req, reply) => {
    const history = await getScratchHistory(req.playerId)
    return reply.send({ cards: history })
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/games/scratch.ts
git commit -m "feat(scratch): add scratch card API routes"
```

---

## Task 4: Lottery Service

**Files:**
- Create: `apps/api/src/services/lottery.service.ts`
- Create: `apps/api/src/services/lottery.service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/services/lottery.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { draw3Numbers, countMatches, calculateLotteryPrize } from './lottery.service.js'

beforeEach(() => vi.clearAllMocks())

describe('draw3Numbers', () => {
  it('returns exactly 3 numbers', () => {
    expect(draw3Numbers()).toHaveLength(3)
  })

  it('all numbers are between 1 and 36 inclusive', () => {
    for (let i = 0; i < 20; i++) {
      const nums = draw3Numbers()
      for (const n of nums) {
        expect(n).toBeGreaterThanOrEqual(1)
        expect(n).toBeLessThanOrEqual(36)
      }
    }
  })

  it('all 3 numbers are unique', () => {
    for (let i = 0; i < 20; i++) {
      const nums = draw3Numbers()
      expect(new Set(nums).size).toBe(3)
    }
  })
})

describe('countMatches', () => {
  it('returns 3 when all picked numbers match winning numbers', () => {
    expect(countMatches([1, 2, 3], [1, 2, 3])).toBe(3)
  })

  it('returns 2 when 2 picked numbers match', () => {
    expect(countMatches([1, 2, 3], [1, 2, 10])).toBe(2)
  })

  it('returns 1 when 1 picked number matches', () => {
    expect(countMatches([1, 2, 3], [1, 20, 30])).toBe(1)
  })

  it('returns 0 when no numbers match', () => {
    expect(countMatches([1, 2, 3], [4, 5, 6])).toBe(0)
  })
})

describe('calculateLotteryPrize', () => {
  it('returns ticketPrice * 100 for 3 matches on hourly', () => {
    expect(calculateLotteryPrize('hourly', 3, 2000)).toBe(200000)
  })

  it('returns ticketPrice * 5 for 2 matches on hourly', () => {
    expect(calculateLotteryPrize('hourly', 2, 2000)).toBe(10000)
  })

  it('returns ticketPrice * 1 for 1 match on hourly (break even)', () => {
    expect(calculateLotteryPrize('hourly', 1, 2000)).toBe(2000)
  })

  it('returns 0 for 0 matches', () => {
    expect(calculateLotteryPrize('hourly', 0, 2000)).toBe(0)
  })

  it('returns ticketPrice * 1000 for 3 matches on weekly', () => {
    expect(calculateLotteryPrize('weekly', 3, 50000)).toBe(50000000)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm vitest run src/services/lottery.service.test.ts
```
Expected: FAIL — `Cannot find module './lottery.service.js'`

- [ ] **Step 3: Implement the lottery service**

```typescript
// apps/api/src/services/lottery.service.ts
import { randomBytes } from 'crypto'
import { pool } from '@betting/db'
import { debitForBet, creditWinnings } from './wallet.service.js'
import { AppError } from '../lib/errors.js'

export const TICKET_PRICES: Record<string, number> = {
  hourly: 2000,   // KES 20
  daily:  10000,  // KES 100
  weekly: 50000,  // KES 500
}

const PRIZE_MULTIPLIERS: Record<string, Record<number, number>> = {
  hourly: { 3: 100, 2: 5,  1: 1, 0: 0 },
  daily:  { 3: 300, 2: 8,  1: 1, 0: 0 },
  weekly: { 3: 1000, 2: 15, 1: 1, 0: 0 },
}

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
    throw new AppError('INVALID_DRAW_TYPE', 'Invalid draw type', 400)
  }
  if (pickedNumbers.length !== 3) {
    throw new AppError('INVALID_NUMBERS', 'Must pick exactly 3 numbers', 400)
  }
  if (pickedNumbers.some(n => n < 1 || n > 36 || !Number.isInteger(n))) {
    throw new AppError('INVALID_NUMBERS', 'Numbers must be integers between 1 and 36', 400)
  }
  if (new Set(pickedNumbers).size !== 3) {
    throw new AppError('INVALID_NUMBERS', 'Numbers must be unique', 400)
  }

  const { rows: drawRows } = await pool.query<{ id: string; scheduled_at: string; ticket_price: string }>(
    `SELECT id, scheduled_at, ticket_price FROM lottery_draws
     WHERE draw_type = $1 AND status = 'pending' AND scheduled_at > NOW()
     ORDER BY scheduled_at ASC LIMIT 1`,
    [drawType],
  )

  if (drawRows.length === 0) {
    throw new AppError('DRAW_NOT_FOUND', 'No upcoming draw available for this type', 404)
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

  for (const ticket of tickets) {
    const ticketPrice = Number(ticket.ticket_price)
    const matched = countMatches(winningNumbers, ticket.picked_numbers)
    const prizeCents = calculateLotteryPrize(drawType, matched, ticketPrice)
    const status = prizeCents > 0 ? 'won' : 'lost'

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE lottery_tickets SET matched_count = $1, prize_cents = $2, status = $3 WHERE id = $4`,
        [matched, prizeCents, status, ticket.id],
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
    } finally {
      client.release()
    }
  }
}

export async function getUpcomingDraws(): Promise<{
  id: string; drawType: string; ticketPrice: number; scheduledAt: string; jackpot: number
}[]> {
  const { rows } = await pool.query<{
    id: string; draw_type: string; ticket_price: string; scheduled_at: string
  }>(
    `SELECT DISTINCT ON (draw_type) id, draw_type, ticket_price, scheduled_at
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
    }
  })
}

export async function getPlayerTickets(playerId: string): Promise<{
  id: string; drawType: string; pickedNumbers: number[]; ticketPrice: number
  matchedCount: number | null; prizeCents: number; status: string
  scheduledAt: string; winningNumbers: number[] | null; createdAt: string
}[]> {
  const { rows } = await pool.query<{
    id: string; draw_type: string; picked_numbers: number[]; ticket_price: string
    matched_count: number | null; prize_cents: string; status: string
    scheduled_at: string; winning_numbers: number[] | null; created_at: string
  }>(
    `SELECT t.id, d.draw_type, t.picked_numbers, t.ticket_price,
            t.matched_count, t.prize_cents, t.status,
            d.scheduled_at, d.winning_numbers, t.created_at
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
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm vitest run src/services/lottery.service.test.ts
```
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/lottery.service.ts apps/api/src/services/lottery.service.test.ts
git commit -m "feat(lottery): add lottery service with RNG, prize calc, buy/settle/query functions"
```

---

## Task 5: Lottery Scheduler Loop

**Files:**
- Create: `apps/api/src/game/lottery-loop.ts`

- [ ] **Step 1: Create the scheduler**

```typescript
// apps/api/src/game/lottery-loop.ts
import { pool } from '@betting/db'
import { draw3Numbers, settleTickets, TICKET_PRICES } from '../services/lottery.service.js'

type DrawType = 'hourly' | 'daily' | 'weekly'

let running = false

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getNextDrawTime(drawType: DrawType): Date {
  const now = new Date()
  if (drawType === 'hourly') {
    const next = new Date(now)
    next.setMinutes(0, 0, 0)
    next.setHours(next.getHours() + 1)
    return next
  }
  if (drawType === 'daily') {
    // 20:00 EAT = 17:00 UTC
    const next = new Date(now)
    next.setUTCHours(17, 0, 0, 0)
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
    return next
  }
  // weekly: next Sunday at 17:00 UTC
  const next = new Date(now)
  next.setUTCHours(17, 0, 0, 0)
  const day = next.getUTCDay() // 0 = Sunday
  const daysUntilSunday = day === 0 && next > now ? 0 : (7 - day) % 7 || 7
  next.setUTCDate(next.getUTCDate() + daysUntilSunday)
  return next
}

async function runLoop(drawType: DrawType): Promise<void> {
  while (running) {
    try {
      // Find or create pending draw
      const { rows } = await pool.query<{ id: string; scheduled_at: string }>(
        `SELECT id, scheduled_at FROM lottery_draws
         WHERE draw_type = $1 AND status = 'pending'
         ORDER BY scheduled_at ASC LIMIT 1`,
        [drawType],
      )

      let drawId: string
      let scheduledAt: Date

      if (rows.length > 0) {
        drawId = rows[0].id
        scheduledAt = new Date(rows[0].scheduled_at)
      } else {
        const nextTime = getNextDrawTime(drawType)
        const { rows: inserted } = await pool.query<{ id: string }>(
          `INSERT INTO lottery_draws (draw_type, ticket_price, scheduled_at)
           VALUES ($1, $2, $3) RETURNING id`,
          [drawType, TICKET_PRICES[drawType], nextTime],
        )
        drawId = inserted[0].id
        scheduledAt = nextTime
      }

      const msUntilDraw = Math.max(0, scheduledAt.getTime() - Date.now())
      if (msUntilDraw > 0) await sleep(msUntilDraw)
      if (!running) break

      // Fire the draw
      const winningNumbers = draw3Numbers()
      await pool.query(
        `UPDATE lottery_draws SET status = 'completed', drawn_at = NOW(), winning_numbers = $1 WHERE id = $2`,
        [winningNumbers, drawId],
      )
      console.log(`[lottery] ${drawType} draw fired:`, winningNumbers)

      await settleTickets(drawId, drawType, winningNumbers)
    } catch (err) {
      console.error(`[lottery] ${drawType} loop error`, err)
      await sleep(5000) // back off on error
    }
  }
}

export function startLotteryLoop(): void {
  running = true
  runLoop('hourly').catch(err => console.error('[lottery] hourly loop crashed', err))
  runLoop('daily').catch(err => console.error('[lottery] daily loop crashed', err))
  runLoop('weekly').catch(err => console.error('[lottery] weekly loop crashed', err))
  console.log('[lottery] scheduler started')
}

export function stopLotteryLoop(): void {
  running = false
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/game/lottery-loop.ts
git commit -m "feat(lottery): add lottery scheduler loop (hourly/daily/weekly)"
```

---

## Task 6: Lottery API Routes

**Files:**
- Create: `apps/api/src/routes/games/lottery.ts`

- [ ] **Step 1: Create the route file**

```typescript
// apps/api/src/routes/games/lottery.ts
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import {
  getUpcomingDraws,
  buyTicket,
  getPlayerTickets,
} from '../../services/lottery.service.js'
import { AppError } from '../../lib/errors.js'

const buyBody = z.object({
  drawType: z.enum(['hourly', 'daily', 'weekly']),
  pickedNumbers: z.array(z.number().int().min(1).max(36)).length(3),
})

export async function lotteryRoutes(app: FastifyInstance) {
  app.get('/games/lottery/draws', { preHandler: authenticate }, async (_req, reply) => {
    const draws = await getUpcomingDraws()
    return reply.send({ draws })
  })

  app.post('/games/lottery/tickets', { preHandler: authenticate }, async (req, reply) => {
    const parsed = buyBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }
    try {
      const result = await buyTicket(
        req.playerId,
        parsed.data.drawType,
        parsed.data.pickedNumbers,
      )
      return reply.status(201).send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  app.get('/games/lottery/tickets/mine', { preHandler: authenticate }, async (req, reply) => {
    const tickets = await getPlayerTickets(req.playerId)
    return reply.send({ tickets })
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/games/lottery.ts
git commit -m "feat(lottery): add lottery API routes"
```

---

## Task 7: Banner Service + Routes

**Files:**
- Create: `apps/api/src/routes/banners/public.ts`
- Create: `apps/api/src/routes/admin/banners.ts`

- [ ] **Step 1: Create public banner routes**

```typescript
// apps/api/src/routes/banners/public.ts
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticate } from '../../middleware/authenticate.js'

interface BannerRow {
  id: string; headline: string; subtext: string; cta_text: string
  cta_url: string; image_url: string; gradient: string
}

async function getActiveBanner(placement: string) {
  const { rows } = await pool.query<BannerRow>(
    `SELECT id, headline, subtext, cta_text, cta_url, image_url, gradient
     FROM banners WHERE placement = $1 AND active = true LIMIT 1`,
    [placement],
  )
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    id: r.id, headline: r.headline, subtext: r.subtext,
    ctaText: r.cta_text, ctaUrl: r.cta_url, imageUrl: r.image_url, gradient: r.gradient,
  }
}

export async function bannerPublicRoutes(app: FastifyInstance) {
  // Landing banner — no auth (public)
  app.get('/banners/landing', async (_req, reply) => {
    return reply.send({ banner: await getActiveBanner('landing') })
  })

  // Lobby banner — requires player JWT
  app.get('/banners/lobby', { preHandler: authenticate }, async (_req, reply) => {
    return reply.send({ banner: await getActiveBanner('lobby') })
  })
}
```

- [ ] **Step 2: Create admin banner routes**

```typescript
// apps/api/src/routes/admin/banners.ts
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'

const bannerBody = z.object({
  placement: z.enum(['landing', 'lobby']),
  headline: z.string().min(1).max(80),
  subtext: z.string().max(160).default(''),
  ctaText: z.string().max(40).default(''),
  ctaUrl: z.string().max(255).default('/wallet/deposit'),
  imageUrl: z.string().max(500).default(''),
  gradient: z.string().max(100).default('from-cyan-900/60 to-violet-900/40'),
})

const updateBody = bannerBody.partial().omit({ placement: true })

export async function adminBannerRoutes(app: FastifyInstance) {
  app.get('/admin/banners', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const { rows } = await pool.query(
      `SELECT id, placement, headline, subtext, cta_text, cta_url, image_url, gradient, active, created_at
       FROM banners ORDER BY placement, created_at DESC`,
    )
    return reply.send({ banners: rows.map(r => ({
      id: r.id, placement: r.placement, headline: r.headline, subtext: r.subtext,
      ctaText: r.cta_text, ctaUrl: r.cta_url, imageUrl: r.image_url,
      gradient: r.gradient, active: r.active, createdAt: r.created_at,
    })) })
  })

  app.post('/admin/banners', { preHandler: authenticateAdmin }, async (req, reply) => {
    const parsed = bannerBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    const d = parsed.data
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO banners (placement, headline, subtext, cta_text, cta_url, image_url, gradient)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [d.placement, d.headline, d.subtext, d.ctaText, d.ctaUrl, d.imageUrl, d.gradient],
    )
    return reply.status(201).send({ id: rows[0].id })
  })

  app.put('/admin/banners/:id', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    const d = parsed.data
    await pool.query(
      `UPDATE banners SET
        headline  = COALESCE($1, headline),
        subtext   = COALESCE($2, subtext),
        cta_text  = COALESCE($3, cta_text),
        cta_url   = COALESCE($4, cta_url),
        image_url = COALESCE($5, image_url),
        gradient  = COALESCE($6, gradient),
        updated_at = NOW()
       WHERE id = $7`,
      [d.headline ?? null, d.subtext ?? null, d.ctaText ?? null,
       d.ctaUrl ?? null, d.imageUrl ?? null, d.gradient ?? null, id],
    )
    return reply.send({ ok: true })
  })

  app.put('/admin/banners/:id/activate', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    // Get placement of target banner
    const { rows } = await pool.query<{ placement: string }>(
      `SELECT placement FROM banners WHERE id = $1`, [id],
    )
    if (rows.length === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Banner not found' } })
    }
    const { placement } = rows[0]
    // Deactivate all in same placement, then activate target
    await pool.query(`UPDATE banners SET active = false WHERE placement = $1`, [placement])
    await pool.query(`UPDATE banners SET active = true, updated_at = NOW() WHERE id = $1`, [id])
    return reply.send({ ok: true })
  })

  app.delete('/admin/banners/:id', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await pool.query(`DELETE FROM banners WHERE id = $1`, [id])
    return reply.status(204).send()
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/banners/public.ts apps/api/src/routes/admin/banners.ts
git commit -m "feat(banners): add public banner routes and admin CRUD routes"
```

---

## Task 8: Wire Server + Index

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Register new routes in server.ts**

Add these imports after the existing imports:
```typescript
import { scratchRoutes } from './routes/games/scratch.js'
import { lotteryRoutes } from './routes/games/lottery.js'
import { bannerPublicRoutes } from './routes/banners/public.js'
import { adminBannerRoutes } from './routes/admin/banners.js'
```

Add these registrations after `app.register(diceRoutes)`:
```typescript
  app.register(scratchRoutes)
  app.register(lotteryRoutes)
  app.register(bannerPublicRoutes)
  app.register(adminBannerRoutes)
```

- [ ] **Step 2: Start lottery loop in index.ts**

Add import at top of `apps/api/src/index.ts`:
```typescript
import { startLotteryLoop } from './game/lottery-loop.js'
```

Add call after `startCrashLoop(io)`:
```typescript
  startLotteryLoop()
```

- [ ] **Step 3: Run the API type-check to catch any issues**

```bash
cd apps/api && pnpm tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/index.ts
git commit -m "feat(api): register lottery, scratch, banner routes; start lottery loop on boot"
```

---

## Task 9: Admin Dashboard — Promotions Tab

**Files:**
- Modify: `apps/admin/src/app/dashboard/page.tsx`

- [ ] **Step 1: Rewrite the dashboard page**

```typescript
// apps/admin/src/app/dashboard/page.tsx
'use client'
import { useEffect, useState, useCallback } from 'react'
import { isAuthenticated, clearToken } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'

// ─── Stats types ────────────────────────────────────────────────────────────
interface Stats {
  totalPlayers: number; totalDeposits: number; totalBetVolume: number
  totalPaidOut: number; houseRevenue: number; totalHeldBalance: number
  totalBets: number
  recentBets: { id: string; playerName: string; gameType: string; grossStake: number; winnings: number | null; status: string; createdAt: string }[]
}

// ─── Banner types ────────────────────────────────────────────────────────────
interface Banner {
  id: string; placement: 'landing' | 'lobby'; headline: string; subtext: string
  ctaText: string; ctaUrl: string; imageUrl: string; gradient: string
  active: boolean; createdAt: string
}

const GRADIENT_PRESETS = [
  { label: 'Ocean',  value: 'from-cyan-900/60 to-violet-900/40' },
  { label: 'Fire',   value: 'from-orange-900/60 to-red-900/40' },
  { label: 'Forest', value: 'from-green-900/60 to-emerald-900/40' },
  { label: 'Royal',  value: 'from-violet-900/60 to-blue-900/40' },
  { label: 'Gold',   value: 'from-yellow-900/60 to-orange-900/40' },
]

const STATUS_COLORS: Record<string, string> = {
  won: 'text-green-400', lost: 'text-red-400', active: 'text-yellow-400', refunded: 'text-gray-400',
}

function kes(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

// ─── Banner form component ───────────────────────────────────────────────────
function BannerForm({ placement, onCreated }: { placement: 'landing' | 'lobby'; onCreated: () => void }) {
  const [headline, setHeadline] = useState('')
  const [subtext, setSubtext] = useState('')
  const [ctaText, setCtaText] = useState('')
  const [ctaUrl, setCtaUrl] = useState(placement === 'landing' ? '/register' : '/wallet/deposit')
  const [imageUrl, setImageUrl] = useState('')
  const [gradient, setGradient] = useState(GRADIENT_PRESETS[0].value)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { data } = await apiFetch('/admin/banners', {
      method: 'POST',
      body: JSON.stringify({ placement, headline, subtext, ctaText, ctaUrl, imageUrl, gradient }),
    })
    setSaving(false)
    if (data) { setOpen(false); setHeadline(''); setSubtext(''); setCtaText(''); setImageUrl(''); onCreated() }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="px-3 py-1.5 text-xs rounded-lg border border-dashed border-gray-700 hover:border-gray-500 text-gray-500 hover:text-white transition-colors">
      + New Banner
    </button>
  )

  return (
    <form onSubmit={handleSubmit} className="mt-4 bg-gray-800 rounded-xl p-4 space-y-3">
      <div>
        <label className="text-xs text-gray-400 block mb-1">Headline <span className="text-gray-600">({headline.length}/80)</span></label>
        <input value={headline} onChange={e => setHeadline(e.target.value)} maxLength={80} required
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500/50"/>
      </div>
      <div>
        <label className="text-xs text-gray-400 block mb-1">Subtext <span className="text-gray-600">({subtext.length}/160)</span></label>
        <input value={subtext} onChange={e => setSubtext(e.target.value)} maxLength={160}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500/50"/>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">CTA Text <span className="text-gray-600">({ctaText.length}/40)</span></label>
          <input value={ctaText} onChange={e => setCtaText(e.target.value)} maxLength={40}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500/50"/>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">CTA URL</label>
          <input value={ctaUrl} onChange={e => setCtaUrl(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500/50"/>
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-400 block mb-1">
          Image URL <span className="text-gray-600">— Recommended: 1200×300 px · 4:1 ratio · max 500 KB · PNG or JPG</span>
        </label>
        <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://..."
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500/50"/>
      </div>
      <div>
        <label className="text-xs text-gray-400 block mb-2">Gradient (used when no image)</label>
        <div className="flex gap-2 flex-wrap">
          {GRADIENT_PRESETS.map(p => (
            <button type="button" key={p.value} onClick={() => setGradient(p.value)}
              className={`px-3 py-1 rounded-lg text-xs border transition-colors bg-gradient-to-r ${p.value} ${gradient === p.value ? 'border-white text-white' : 'border-gray-700 text-gray-400'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {/* Live preview */}
      <div className={`rounded-xl p-5 bg-gradient-to-r ${gradient} flex items-center justify-between`}
        style={imageUrl ? { backgroundImage: `url(${imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
        <div>
          <p className="font-bold text-white text-lg">{headline || 'Your headline'}</p>
          <p className="text-gray-300 text-sm">{subtext}</p>
        </div>
        {ctaText && <span className="ml-4 px-4 py-2 rounded-lg bg-cyan-400 text-black text-sm font-bold whitespace-nowrap">{ctaText}</span>}
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-cyan-500 text-black text-sm font-bold disabled:opacity-50">
          {saving ? 'Saving…' : 'Create Banner'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-400 hover:text-white">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ─── Banner list for one placement ──────────────────────────────────────────
function BannerSection({ placement, banners, onRefresh }: {
  placement: 'landing' | 'lobby'; banners: Banner[]; onRefresh: () => void
}) {
  async function activate(id: string) {
    await apiFetch(`/admin/banners/${id}/activate`, { method: 'PUT' })
    onRefresh()
  }
  async function remove(id: string) {
    if (!confirm('Delete this banner?')) return
    await apiFetch(`/admin/banners/${id}`, { method: 'DELETE' })
    onRefresh()
  }

  const list = banners.filter(b => b.placement === placement)
  const label = placement === 'landing' ? 'Landing Page' : 'Games Lobby'

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-gray-300">{label}</h3>
        <BannerForm placement={placement} onCreated={onRefresh} />
      </div>
      {list.length === 0 ? (
        <p className="text-gray-600 text-sm py-4">No banners yet</p>
      ) : (
        <div className="space-y-3">
          {list.map(b => (
            <div key={b.id} className={`rounded-xl border p-4 ${b.active ? 'border-cyan-500/40 bg-cyan-900/10' : 'border-gray-800 bg-gray-900'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {b.active && <span className="text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded-full px-2 py-0.5">LIVE</span>}
                    <p className="font-semibold text-sm truncate">{b.headline}</p>
                  </div>
                  {b.subtext && <p className="text-gray-500 text-xs truncate">{b.subtext}</p>}
                  {b.ctaText && <p className="text-gray-600 text-xs mt-1">CTA: {b.ctaText} → {b.ctaUrl}</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {!b.active && (
                    <button onClick={() => activate(b.id)}
                      className="px-2 py-1 rounded text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors">
                      Activate
                    </button>
                  )}
                  <button onClick={() => remove(b.id)}
                    className="px-2 py-1 rounded text-xs bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main dashboard ──────────────────────────────────────────────────────────
export default function AdminDashboardPage() {
  const router = useRouter()
  const [tab, setTab] = useState<'stats' | 'promotions'>('stats')
  const [stats, setStats] = useState<Stats | null>(null)
  const [banners, setBanners] = useState<Banner[]>([])
  const [statsLoading, setStatsLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchStats = useCallback(async () => {
    const { data } = await apiFetch<Stats>('/admin/stats')
    if (data) { setStats(data); setLastUpdated(new Date()) }
    setStatsLoading(false)
  }, [])

  const fetchBanners = useCallback(async () => {
    const { data } = await apiFetch<{ banners: Banner[] }>('/admin/banners')
    if (data) setBanners(data.banners)
  }, [])

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/login'); return }
    fetchStats()
    fetchBanners()
    const interval = setInterval(fetchStats, 30_000)
    return () => clearInterval(interval)
  }, [router, fetchStats, fetchBanners])

  function handleLogout() { clearToken(); router.push('/login') }

  const statCards = stats ? [
    { label: 'Total Players',  value: stats.totalPlayers.toLocaleString(),  color: 'text-blue-400',   icon: '👥' },
    { label: 'Total Bets',     value: stats.totalBets.toLocaleString(),     color: 'text-purple-400', icon: '🎲' },
    { label: 'Bet Volume',     value: kes(stats.totalBetVolume),            color: 'text-cyan-400',   icon: '📊' },
    { label: 'Paid Out',       value: kes(stats.totalPaidOut),              color: 'text-orange-400', icon: '💸' },
    { label: 'House Revenue',  value: kes(stats.houseRevenue),              color: stats.houseRevenue >= 0 ? 'text-green-400' : 'text-red-400', icon: '🏦' },
    { label: 'Deposits (real)',value: kes(stats.totalDeposits),             color: 'text-emerald-400',icon: '💰' },
    { label: 'Balance Held',   value: kes(stats.totalHeldBalance),          color: 'text-yellow-400', icon: '🏧' },
  ] : []

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">
            <span className="text-cyan-400">WINGU</span><span className="text-violet-400">BET</span>
            <span className="text-gray-400 font-normal text-base ml-3">Admin</span>
          </h1>
          {lastUpdated && <p className="text-xs text-gray-600 mt-1">Updated: {lastUpdated.toLocaleTimeString()} · auto-refreshes every 30s</p>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchStats} className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 transition-colors">↻ Refresh</button>
          <button onClick={handleLogout} className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 transition-colors">Log out</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {(['stats', 'promotions'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold capitalize border-b-2 transition-colors ${tab === t ? 'border-cyan-400 text-white' : 'border-transparent text-gray-500 hover:text-white'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Stats tab */}
      {tab === 'stats' && (
        statsLoading ? (
          <div className="flex items-center justify-center h-64 text-gray-500">Loading…</div>
        ) : !stats ? (
          <div className="flex items-center justify-center h-64 text-red-400">Failed to load stats</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {statCards.map(c => (
                <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{c.icon}</span>
                    <span className="text-xs text-gray-500 uppercase tracking-wide">{c.label}</span>
                  </div>
                  <p className={`text-lg font-bold font-mono ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
                <h2 className="font-semibold text-sm">Recent Bets</h2>
                <span className="text-xs text-gray-500">{stats.recentBets.length} shown</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                      <th className="text-left px-5 py-3">Player</th>
                      <th className="text-left px-5 py-3">Game</th>
                      <th className="text-right px-5 py-3">Stake</th>
                      <th className="text-right px-5 py-3">Winnings</th>
                      <th className="text-left px-5 py-3">Status</th>
                      <th className="text-left px-5 py-3">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentBets.map(b => (
                      <tr key={b.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-5 py-3 font-medium">{b.playerName}</td>
                        <td className="px-5 py-3 uppercase text-xs font-mono text-gray-400">{b.gameType}</td>
                        <td className="px-5 py-3 text-right font-mono text-gray-300">{kes(b.grossStake)}</td>
                        <td className="px-5 py-3 text-right font-mono">
                          {b.winnings !== null ? (
                            <span className={b.winnings > 0 ? 'text-green-400' : 'text-gray-500'}>{kes(b.winnings)}</span>
                          ) : <span className="text-gray-600">—</span>}
                        </td>
                        <td className={`px-5 py-3 capitalize font-semibold text-xs ${STATUS_COLORS[b.status] ?? 'text-gray-400'}`}>{b.status}</td>
                        <td className="px-5 py-3 text-gray-500 text-xs">{new Date(b.createdAt).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                    {stats.recentBets.length === 0 && (
                      <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-600">No bets yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      )}

      {/* Promotions tab */}
      {tab === 'promotions' && (
        <div className="max-w-3xl">
          <p className="text-gray-500 text-sm mb-6">
            Manage promotional banners shown on the landing page and the games lobby.
            Only one banner per placement can be active at a time.
          </p>
          <BannerSection placement="landing" banners={banners} onRefresh={fetchBanners} />
          <BannerSection placement="lobby"   banners={banners} onRefresh={fetchBanners} />
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/src/app/dashboard/page.tsx
git commit -m "feat(admin): add Promotions tab with Landing + Lobby banner management"
```

---

## Task 10: Frontend — Scratch Card Page

**Files:**
- Create: `apps/web/src/app/(player)/games/scratch/page.tsx`

- [ ] **Step 1: Create the scratch card page**

```typescript
// apps/web/src/app/(player)/games/scratch/page.tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { refreshBalance } from '@/lib/auth'

const SYMBOLS = ['💎', '🌟', '🍀', '🔥', '💰', '❌']
const SYMBOL_COLORS = ['text-cyan-300', 'text-yellow-300', 'text-green-400', 'text-orange-400', 'text-yellow-400', 'text-gray-600']
const STAKES = [
  { label: 'KES 20',  cents: 2000  },
  { label: 'KES 50',  cents: 5000  },
  { label: 'KES 100', cents: 10000 },
  { label: 'KES 200', cents: 20000 },
]

interface CardResult {
  cardId: string; grid: number[]; prizeCents: number
}

interface HistoryCard {
  id: string; stakeCents: number; grid: number[]; prizeCents: number; createdAt: string
}

function kes(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

export default function ScratchPage() {
  const [stake, setStake] = useState(2000)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CardResult | null>(null)
  const [revealed, setRevealed] = useState<boolean[]>(Array(9).fill(false))
  const [history, setHistory] = useState<HistoryCard[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleBuy() {
    setLoading(true)
    setError(null)
    setResult(null)
    setRevealed(Array(9).fill(false))
    const { data, error: apiError } = await apiFetch<CardResult>('/games/scratch/buy', {
      method: 'POST',
      body: JSON.stringify({ stake }),
    })
    setLoading(false)
    if (apiError) { setError(apiError.message); return }
    if (data) {
      setResult(data)
      refreshBalance()
      loadHistory()
    }
  }

  function revealTile(i: number) {
    if (revealed[i] || !result) return
    setRevealed(prev => { const next = [...prev]; next[i] = true; return next })
  }

  function revealAll() {
    if (!result) return
    result.grid.forEach((_, i) => {
      setTimeout(() => setRevealed(prev => { const next = [...prev]; next[i] = true; return next }), i * 80)
    })
  }

  async function loadHistory() {
    const { data } = await apiFetch<{ cards: HistoryCard[] }>('/games/scratch/history')
    if (data) { setHistory(data.cards); setHistoryLoaded(true) }
  }

  const allRevealed = revealed.every(Boolean)
  const won = result && result.prizeCents > 0

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/games" className="text-gray-500 hover:text-white text-sm flex items-center gap-1 mb-6 transition-colors w-fit">
        ← Back to Games
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-xl">🎟️</div>
        <div>
          <h1 className="text-xl font-bold">Scratch Card</h1>
          <p className="text-gray-500 text-sm">Reveal 3 matching symbols to win</p>
        </div>
      </div>

      {!result ? (
        <div className="bg-game-card border border-game-border rounded-2xl p-6">
          <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide">Choose your stake</p>
          <div className="grid grid-cols-4 gap-2 mb-6">
            {STAKES.map(s => (
              <button key={s.cents} onClick={() => setStake(s.cents)}
                className={`py-3 rounded-xl text-sm font-bold border transition-colors ${
                  stake === s.cents ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300' : 'border-game-border text-gray-400 hover:border-gray-500'
                }`}>
                {s.label}
              </button>
            ))}
          </div>
          {error && <p className="text-warning-coral text-xs mb-3">{error}</p>}
          <button onClick={handleBuy} disabled={loading}
            className="w-full py-4 rounded-xl bg-emerald-500 text-black font-bold text-base hover:bg-emerald-400 transition disabled:opacity-40">
            {loading ? 'Getting card…' : '🎟️ Buy & Scratch'}
          </button>
        </div>
      ) : (
        <div className="bg-game-card border border-game-border rounded-2xl p-6">
          {/* Win/lose banner */}
          {allRevealed && (
            <div className={`rounded-xl p-4 mb-5 text-center ${won ? 'bg-green-500/10 border border-green-500/30' : 'bg-gray-800/50 border border-gray-700'}`}>
              {won ? (
                <>
                  <p className="text-2xl font-bold text-green-400">🎉 You Won!</p>
                  <p className="text-green-300 font-mono text-lg mt-1">{kes(result.prizeCents)}</p>
                </>
              ) : (
                <p className="text-gray-400">No match this time. Try again!</p>
              )}
            </div>
          )}

          {/* 3×3 grid */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {result.grid.map((symbol, i) => (
              <button key={i} onClick={() => revealTile(i)}
                className={`aspect-square rounded-xl border text-3xl flex items-center justify-center transition-all duration-200 ${
                  revealed[i]
                    ? `bg-game-bg border-game-border ${SYMBOL_COLORS[symbol]}`
                    : 'bg-gradient-to-br from-emerald-900/40 to-teal-900/20 border-emerald-500/30 hover:brightness-110 cursor-pointer text-xl text-emerald-400'
                }`}>
                {revealed[i] ? SYMBOLS[symbol] : '?'}
              </button>
            ))}
          </div>

          <div className="flex gap-3">
            {!allRevealed && (
              <button onClick={revealAll} className="flex-1 py-2.5 rounded-xl border border-game-border text-sm text-gray-400 hover:text-white hover:border-gray-500 transition-colors">
                Reveal All
              </button>
            )}
            <button onClick={() => { setResult(null); setRevealed(Array(9).fill(false)) }}
              className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-black font-bold text-sm hover:bg-emerald-400 transition">
              New Card
            </button>
          </div>
        </div>
      )}

      {/* History */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Recent Cards</h2>
          {!historyLoaded && (
            <button onClick={loadHistory} className="text-xs text-gray-500 hover:text-white transition-colors">Load history</button>
          )}
        </div>
        {history.length > 0 && (
          <div className="space-y-2">
            {history.map(card => (
              <div key={card.id} className="bg-game-card border border-game-border rounded-xl px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex gap-0.5">
                    {card.grid.map((s, i) => <span key={i} className={`text-sm ${SYMBOL_COLORS[s]}`}>{SYMBOLS[s]}</span>)}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">Staked {kes(card.stakeCents)}</p>
                  <p className={`text-sm font-mono font-bold ${card.prizeCents > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                    {card.prizeCents > 0 ? `+${kes(card.prizeCents)}` : 'No win'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/\(player\)/games/scratch/page.tsx
git commit -m "feat(ui): add scratch card game page"
```

---

## Task 11: Frontend — Lottery Page

**Files:**
- Create: `apps/web/src/app/(player)/games/lottery/page.tsx`

- [ ] **Step 1: Create the lottery page**

```typescript
// apps/web/src/app/(player)/games/lottery/page.tsx
'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { refreshBalance } from '@/lib/auth'

interface Draw {
  id: string; drawType: 'hourly' | 'daily' | 'weekly'
  ticketPrice: number; scheduledAt: string; jackpot: number
}

interface Ticket {
  id: string; drawType: string; pickedNumbers: number[]; ticketPrice: number
  matchedCount: number | null; prizeCents: number; status: string
  scheduledAt: string; winningNumbers: number[] | null; createdAt: string
}

const DRAW_LABELS: Record<string, { label: string; accent: string; border: string; gradient: string }> = {
  hourly: { label: 'HOURLY', accent: '#00F2FE', border: 'border-cyan-500/30',   gradient: 'from-cyan-900/40 to-blue-900/20' },
  daily:  { label: 'DAILY',  accent: '#80508B', border: 'border-violet-500/30', gradient: 'from-violet-900/40 to-purple-900/20' },
  weekly: { label: 'WEEKLY', accent: '#00C896', border: 'border-emerald-500/30',gradient: 'from-emerald-900/40 to-teal-900/20' },
}

function kes(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':')
}

export default function LotteryPage() {
  const [draws, setDraws] = useState<Draw[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [now, setNow] = useState(Date.now())
  const [selected, setSelected] = useState<{ drawType: string; numbers: number[] } | null>(null)
  const [buying, setBuying] = useState(false)
  const [buySuccess, setBuySuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchDraws = useCallback(async () => {
    const { data } = await apiFetch<{ draws: Draw[] }>('/games/lottery/draws')
    if (data) setDraws(data.draws)
  }, [])

  const fetchTickets = useCallback(async () => {
    const { data } = await apiFetch<{ tickets: Ticket[] }>('/games/lottery/tickets/mine')
    if (data) setTickets(data.tickets)
  }, [])

  useEffect(() => {
    fetchDraws()
    fetchTickets()
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const refresh = setInterval(fetchDraws, 60_000)
    return () => { clearInterval(tick); clearInterval(refresh) }
  }, [fetchDraws, fetchTickets])

  function toggleNumber(drawType: string, n: number) {
    setSelected(prev => {
      if (prev?.drawType !== drawType) return { drawType, numbers: [n] }
      const nums = prev.numbers.includes(n)
        ? prev.numbers.filter(x => x !== n)
        : prev.numbers.length < 3 ? [...prev.numbers, n] : prev.numbers
      return { drawType, numbers: nums }
    })
    setError(null)
    setBuySuccess(null)
  }

  async function buyTicket() {
    if (!selected || selected.numbers.length !== 3) { setError('Pick exactly 3 numbers'); return }
    setBuying(true); setError(null)
    const { data, error: apiError } = await apiFetch<{ ticketId: string; scheduledAt: string }>(
      '/games/lottery/tickets',
      { method: 'POST', body: JSON.stringify({ drawType: selected.drawType, pickedNumbers: selected.numbers }) },
    )
    setBuying(false)
    if (apiError) { setError(apiError.message); return }
    if (data) {
      setBuySuccess(`Ticket purchased! Draw at ${new Date(data.scheduledAt).toLocaleTimeString()}`)
      setSelected(null)
      refreshBalance()
      fetchTickets()
    }
  }

  const STATUS_STYLES: Record<string, string> = {
    pending: 'text-yellow-400', won: 'text-green-400', lost: 'text-gray-500',
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link href="/games" className="text-gray-500 hover:text-white text-sm flex items-center gap-1 mb-6 transition-colors w-fit">
        ← Back to Games
      </Link>

      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center text-xl">🎱</div>
        <div>
          <h1 className="text-xl font-bold">Lotto — Pick 3</h1>
          <p className="text-gray-500 text-sm">Pick 3 numbers from 1–36. Match all 3 to win the jackpot.</p>
        </div>
      </div>

      {/* Draw tier cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {(['hourly', 'daily', 'weekly'] as const).map(drawType => {
          const draw = draws.find(d => d.drawType === drawType)
          const style = DRAW_LABELS[drawType]
          const msLeft = draw ? new Date(draw.scheduledAt).getTime() - now : 0
          const isPickingThis = selected?.drawType === drawType
          const pickedForThis = isPickingThis ? selected.numbers : []

          return (
            <div key={drawType} className={`bg-gradient-to-br ${style.gradient} border ${style.border} rounded-2xl p-5`}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${style.accent}20`, color: style.accent, border: `1px solid ${style.accent}30` }}>
                  {style.label}
                </span>
                {draw && (
                  <span className="text-xs text-gray-400 font-mono">{formatCountdown(msLeft)}</span>
                )}
              </div>

              <p className="text-xs text-gray-400 mb-1">Jackpot</p>
              <p className="text-lg font-bold font-mono mb-1" style={{ color: style.accent }}>
                {draw ? kes(draw.jackpot) : '—'}
              </p>
              <p className="text-xs text-gray-500 mb-4">
                Ticket: {draw ? kes(draw.ticketPrice) : '—'}
              </p>

              {/* Number picker */}
              {draw && (
                <>
                  <p className="text-xs text-gray-400 mb-2">
                    {isPickingThis ? `${pickedForThis.length}/3 picked` : 'Pick 3 numbers'}
                  </p>
                  <div className="grid grid-cols-6 gap-1 mb-4">
                    {Array.from({ length: 36 }, (_, i) => i + 1).map(n => {
                      const isPicked = pickedForThis.includes(n)
                      return (
                        <button key={n} onClick={() => toggleNumber(drawType, n)}
                          className={`aspect-square rounded text-xs font-mono font-bold transition-colors ${
                            isPicked
                              ? 'text-black'
                              : 'text-gray-400 hover:text-white border border-game-border hover:border-gray-500'
                          }`}
                          style={isPicked ? { background: style.accent } : {}}>
                          {n}
                        </button>
                      )
                    })}
                  </div>

                  {isPickingThis && (
                    <>
                      {error && <p className="text-warning-coral text-xs mb-2">{error}</p>}
                      {buySuccess && <p className="text-green-400 text-xs mb-2">{buySuccess}</p>}
                      <button onClick={buyTicket} disabled={buying || pickedForThis.length !== 3}
                        className="w-full py-2 rounded-xl text-xs font-bold transition disabled:opacity-40"
                        style={{ background: style.accent, color: '#0d0d14' }}>
                        {buying ? 'Buying…' : `Buy Ticket — ${kes(draw.ticketPrice)}`}
                      </button>
                    </>
                  )}
                </>
              )}
              {!draw && <p className="text-gray-600 text-xs">Draw loading…</p>}
            </div>
          )
        })}
      </div>

      {/* My tickets */}
      {tickets.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">My Tickets</h2>
          <div className="space-y-2">
            {tickets.map(t => {
              const style = DRAW_LABELS[t.drawType]
              return (
                <div key={t.id} className="bg-game-card border border-game-border rounded-xl px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold" style={{ color: style?.accent }}>{t.drawType.toUpperCase()}</span>
                    <div className="flex gap-1.5">
                      {t.pickedNumbers.map(n => (
                        <span key={n} className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold border ${
                          t.winningNumbers?.includes(n) ? 'border-green-400 text-green-400 bg-green-400/10' : 'border-game-border text-gray-400'
                        }`}>{n}</span>
                      ))}
                    </div>
                    {t.winningNumbers && (
                      <span className="text-gray-600 text-xs">Drawn: {t.winningNumbers.join(', ')}</span>
                    )}
                  </div>
                  <div className="text-right">
                    <p className={`text-xs font-semibold capitalize ${STATUS_STYLES[t.status] ?? 'text-gray-400'}`}>{t.status}</p>
                    {t.prizeCents > 0 && <p className="text-green-400 text-xs font-mono">+{kes(t.prizeCents)}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/\(player\)/games/lottery/page.tsx
git commit -m "feat(ui): add lottery page with countdown timers, number picker, ticket history"
```

---

## Task 12: Games Lobby + Landing Page — Banner + New Game Cards

**Files:**
- Modify: `apps/web/src/app/(player)/games/page.tsx`
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Update games lobby**

In `apps/web/src/app/(player)/games/page.tsx`:

Add banner state and fetch at the top of the component, after the existing leaderboard fetch:
```typescript
  const [banner, setBanner] = useState<{
    headline: string; subtext: string; ctaText: string; ctaUrl: string
    imageUrl: string; gradient: string
  } | null>(null)

  useEffect(() => {
    apiFetch<{ banner: typeof banner }>('/banners/lobby').then(({ data }) => {
      if (data?.banner) setBanner(data.banner)
    })
  }, [])
```

Add banner rendering above the game grid (before the `<div className="grid ...">` that contains game cards):
```tsx
  {banner && (
    <div className="mb-6 rounded-2xl overflow-hidden border border-white/10 relative"
      style={banner.imageUrl
        ? { backgroundImage: `url(${banner.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : {}}>
      <div className={`${banner.imageUrl ? '' : `bg-gradient-to-r ${banner.gradient}`} p-6 flex items-center justify-between gap-4`}>
        <div>
          <p className="font-bold text-white text-lg md:text-xl">{banner.headline}</p>
          {banner.subtext && <p className="text-gray-300 text-sm mt-1">{banner.subtext}</p>}
        </div>
        {banner.ctaText && (
          <a href={banner.ctaUrl} className="flex-shrink-0 px-5 py-2.5 rounded-xl bg-accent-cyan text-black font-bold text-sm hover:brightness-110 transition">
            {banner.ctaText}
          </a>
        )}
      </div>
    </div>
  )}
```

Add LOTTO and SCRATCH to the `GAMES` array after the existing DICE entry:
```typescript
  {
    href: '/games/lottery',
    name: 'LOTTO',
    tagline: 'Pick 3, draw every hour',
    description: 'Pick 3 numbers from 1–36 and wait for the draw. Match all 3 for the jackpot. Hourly, daily and weekly draws.',
    gradient: 'from-yellow-500/20 to-orange-600/10',
    border: 'border-yellow-500/30',
    accent: '#F5A623',
    badge: 'DRAW',
    badgeColor: 'bg-yellow-500/20 text-yellow-400',
    visual: (
      <svg viewBox="0 0 80 50" className="w-20 h-12 opacity-80">
        {[12, 36, 52].map((cx, i) => (
          <g key={i}>
            <circle cx={cx} cy="25" r="14" fill="#1a1025" stroke="#F5A623" strokeWidth="1.5"/>
            <text x={cx} y="30" fontSize="11" textAnchor="middle" fill="#F5A623" fontWeight="bold">
              {[7, 23, 31][i]}
            </text>
          </g>
        ))}
        <circle cx="74" cy="10" r="8" fill="#F5A62333" stroke="#F5A623" strokeWidth="1"/>
        <text x="74" y="14" fontSize="7" textAnchor="middle" fill="#F5A623">?</text>
      </svg>
    ),
  },
  {
    href: '/games/scratch',
    name: 'SCRATCH',
    tagline: 'Instant win scratch cards',
    description: 'Buy a scratch card and reveal a 3×3 grid of symbols. Match 3 or more of the same symbol anywhere to win.',
    gradient: 'from-emerald-500/20 to-green-700/10',
    border: 'border-emerald-500/30',
    accent: '#00C896',
    badge: 'INSTANT',
    badgeColor: 'bg-emerald-500/20 text-emerald-300',
    visual: (
      <svg viewBox="0 0 80 50" className="w-20 h-12 opacity-80">
        {[0,1,2,3,4,5,6,7,8].map(i => {
          const col = i % 3, row = Math.floor(i / 3)
          const x = 4 + col * 25, y = 2 + row * 16
          const isGem = i === 1 || i === 4 || i === 7
          return (
            <rect key={i} x={x} y={y} width="20" height="13" rx="2"
              fill={isGem ? '#00C89622' : '#1a1025'}
              stroke={isGem ? '#00C896' : '#3a3530'} strokeWidth="0.8"/>
          )
        })}
        <text x="14" y="12" fontSize="8" textAnchor="middle" fill="#00C896">💎</text>
        <text x="39" y="28" fontSize="8" textAnchor="middle" fill="#00C896">💎</text>
        <text x="64" y="44" fontSize="8" textAnchor="middle" fill="#00C896">💎</text>
      </svg>
    ),
  },
```

- [ ] **Step 2: Update landing page with banner**

In `apps/web/src/app/page.tsx`, add banner state and fetch inside the `LandingPage` component's `useEffect`:

```typescript
  const [landingBanner, setLandingBanner] = useState<{
    headline: string; subtext: string; ctaText: string; ctaUrl: string; imageUrl: string; gradient: string
  } | null>(null)

  useEffect(() => {
    if (isAuthenticated()) { router.replace('/games'); return }
    fetch(`${API_URL}/banners/landing`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.banner) setLandingBanner(d.banner) })
      .catch(() => {})
    fetch(`${API_URL}/games/leaderboard`)
      .then(r => r.ok ? r.json() : []).then(setWins).catch(() => {})
  }, [router])
```

Add the banner section between the live wins ticker and the games section. Replace the existing single `/* Games */` comment with:
```tsx
      {/* Landing banner */}
      {landingBanner && (
        <section className="max-w-7xl mx-auto px-4 pt-10">
          <div className="rounded-2xl overflow-hidden border border-white/10"
            style={landingBanner.imageUrl
              ? { backgroundImage: `url(${landingBanner.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : {}}>
            <div className={`${landingBanner.imageUrl ? '' : `bg-gradient-to-r ${landingBanner.gradient}`} p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-6`}>
              <div className="text-center md:text-left">
                <p className="text-2xl md:text-3xl font-extrabold text-white">{landingBanner.headline}</p>
                {landingBanner.subtext && <p className="text-gray-300 mt-2 max-w-lg">{landingBanner.subtext}</p>}
              </div>
              {landingBanner.ctaText && (
                <a href={landingBanner.ctaUrl}
                  className="flex-shrink-0 px-8 py-3 rounded-xl font-bold text-[#0d0d14] transition-transform hover:scale-105"
                  style={{ background: 'linear-gradient(135deg, #00F2FE, #00C896)' }}>
                  {landingBanner.ctaText}
                </a>
              )}
            </div>
          </div>
        </section>
      )}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(player\)/games/page.tsx apps/web/src/app/page.tsx
git commit -m "feat(ui): add LOTTO + SCRATCH to games lobby, lobby banner, landing page banner"
```

---

## Task 13: Deploy

- [ ] **Step 1: Push to GitHub**

```bash
git push origin master
```

- [ ] **Step 2: Deploy API (migration + new routes + lottery loop)**

```bash
COMMIT=$(git rev-parse HEAD)
curl -s -o /dev/null -w "API: %{http_code}\n" -X POST \
  "https://api.render.com/v1/services/srv-d7eb279o3t8c73ebvvdg/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"commitId\":\"$COMMIT\"}"
```
Expected: `API: 202`

- [ ] **Step 3: Deploy Web (new game pages + banner)**

```bash
curl -s -o /dev/null -w "Web: %{http_code}\n" -X POST \
  "https://api.render.com/v1/services/srv-d7edvs57vvec73ep0shg/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"commitId\":\"$COMMIT\"}"
```
Expected: `Web: 202`

- [ ] **Step 4: Deploy Admin (promotions tab)**

```bash
curl -s -o /dev/null -w "Admin: %{http_code}\n" -X POST \
  "https://api.render.com/v1/services/srv-d7ee004vikkc73enkl40/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"commitId\":\"$COMMIT\"}"
```
Expected: `Admin: 202`

- [ ] **Step 5: Verify**

After ~4 minutes:
- `wingubid.onrender.com` — landing page shows the seeded landing banner
- `wingubid.onrender.com/games` — shows CRASH, MINES, DICE, LOTTO, SCRATCH + lobby banner
- `wingubid.onrender.com/games/scratch` — scratch card game loads, tiles reveal on click
- `wingubid.onrender.com/games/lottery` — three tier cards with countdown timers, number picker works
- `wingubid-admin.onrender.com/dashboard` — Promotions tab shows Landing + Lobby banner sections with activate/delete/create

---

## Self-Review

**Spec coverage check:**
- ✅ `lottery_draws`, `lottery_tickets`, `scratch_cards`, `banners` tables — Task 1
- ✅ Hourly/daily/weekly draw scheduler — Task 5
- ✅ API-down recovery (msUntilDraw = 0 if past due) — Task 5 `Math.max(0, ...)`
- ✅ DRAW_CLOSED validation — Task 4 (`scheduled_at > NOW()` in buyTicket query)
- ✅ Pick 3 from 1–36, RNG from `crypto.randomBytes` — Task 4
- ✅ Prize tiers (×100/×300/×1000 for 3 matches) — Task 4
- ✅ Scratch card weighted symbol grid, prize calc, instant settle — Task 2
- ✅ KES 20/50/100/200 stake options — Task 2
- ✅ Banner placement `landing`|`lobby` — Task 7
- ✅ Public route for landing banner (no auth), lobby banner (player JWT) — Task 7
- ✅ Admin CRUD + activate (deactivates others in same placement) — Task 7
- ✅ Image URL field with 1200×300 spec note in admin UI — Task 9
- ✅ Gradient presets — Task 9
- ✅ Live preview in banner form — Task 9
- ✅ Demo banners seeded in migration — Task 1
- ✅ LOTTO + SCRATCH cards in games lobby — Task 12
- ✅ Lobby banner on `/games` — Task 12
- ✅ Landing banner on `/` — Task 12
- ✅ `refreshBalance()` called after scratch win and lottery ticket purchase — Tasks 10, 11
- ✅ All game routes flow through `debitForBet`/`creditWinnings` → `transactions` table → admin stats auto-includes them — Tasks 2, 4

**Type consistency:** `drawType` used consistently throughout service, routes, frontend. `prizeCents`/`stakeCents` naming consistent. `TICKET_PRICES` exported from lottery service and imported in loop.
