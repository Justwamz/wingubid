# Phase 3b — Crash, Mines & Dice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three provably fair casino games (Crash, Mines, Dice) with real-time Socket.io gameplay, violet/cyan neon UI, and full wallet integration.

**Architecture:** Game logic runs in `wingubid-api`. Crash uses Socket.io; Mines and Dice use REST. Redis stores live round/game state. All money flows through the existing wallet service.

**Tech Stack:** Node 20, TypeScript 5, Fastify 4, Socket.io 4, ioredis 5, Next.js 14, Vitest, pnpm monorepo

**UI colours (from design mockup):**
- Background charcoal: `#272422`
- Accent cyan: `#00F2FE` (win state, CTAs)
- Primary violet: `#80508B` (secondary elements)
- Warning coral: `#FF4E50` (crash/loss state)

---

## File Map

**packages/db/migrations:**
- Create: `011_game_settings.sql`
- Create: `012_bets_game_type.sql`

**apps/api/src:**
- Modify: `env.ts` — add Phase 2 vars
- Modify: `server.ts` — add auth + game routes
- Modify: `index.ts` — Socket.io init after listen
- Modify: `package.json` — merge Phase 2 deps + add socket.io
- Create: `lib/crash-rng.ts`
- Create: `lib/crash-rng.test.ts`
- Create: `services/crash.service.ts`
- Create: `services/crash.service.test.ts`
- Create: `services/mines.service.ts`
- Create: `services/mines.service.test.ts`
- Create: `services/dice.service.ts`
- Create: `services/dice.service.test.ts`
- Create: `game/crash-loop.ts`
- Create: `game/crash-socket.ts`
- Create: `game/crash-socket.test.ts`
- Create: `routes/games/leaderboard.ts`
- Create: `routes/games/history.ts`
- Create: `routes/games/mines.ts`
- Create: `routes/games/dice.ts`

**apps/web/src:**
- Modify: `tailwind.config.ts` — neon colour tokens
- Modify: `package.json` — add socket.io-client
- Create: `lib/sounds.ts`
- Create: `lib/haptics.ts`
- Create: `hooks/useCrashGame.ts`
- Create: `hooks/useMinesGame.ts`
- Create: `components/game/MultiplierDisplay.tsx`
- Create: `components/game/BetPanel.tsx`
- Create: `components/game/MinesGrid.tsx`
- Create: `components/game/DiceSlider.tsx`
- Create: `components/game/RoundHistory.tsx`
- Create: `components/game/LiveLeaderboard.tsx`
- Create: `app/(player)/games/page.tsx`
- Create: `app/(player)/games/crash/page.tsx`
- Create: `app/(player)/games/mines/page.tsx`
- Create: `app/(player)/games/dice/page.tsx`

---

## Task 1: Merge feature/phase-2 into master

**Files:** `server.ts`, `env.ts`, `index.ts`, `apps/api/package.json`, all Phase 2 files

- [ ] **Step 1: Run the merge**

```bash
git merge feature/phase-2 --no-commit
```

Expected: conflicts in `apps/api/src/server.ts`, `apps/api/src/env.ts`, `apps/api/src/index.ts`, `apps/api/package.json`

- [ ] **Step 2: Resolve env.ts — add Phase 2 vars to Phase 3a schema**

Write `apps/api/src/env.ts`:
```typescript
import { z } from 'zod'

const schema = z.object({
  NODE_ENV:           z.enum(['development', 'test', 'production']).default('development'),
  PORT:               z.coerce.number().default(3001),
  DATABASE_URL:       z.string().min(1),
  REDIS_URL:          z.string().min(1),
  JWT_SECRET:         z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ADMIN_JWT_SECRET:   z.string().min(32),
  SMS_ENABLED:        z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  AT_API_KEY:         z.string().default(''),
  AT_USERNAME:        z.string().default('sandbox'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
```

- [ ] **Step 3: Resolve server.ts — combine Phase 2 auth routes + Phase 3a wallet/payment routes**

Write `apps/api/src/server.ts`:
```typescript
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { healthRoutes } from './routes/health.js'
import { registerRoutes } from './routes/auth/register.js'
import { verifyOtpRoutes } from './routes/auth/verify-otp.js'
import { loginRoutes } from './routes/auth/login.js'
import { refreshRoutes } from './routes/auth/refresh.js'
import { logoutRoutes } from './routes/auth/logout.js'
import { adminAuthRoutes } from './routes/admin/auth.js'
import { playerMeRoutes } from './routes/player/me.js'
import { walletBalanceRoutes } from './routes/wallet/balance.js'
import { walletDepositRoutes } from './routes/wallet/deposit.js'
import { walletWithdrawRoutes } from './routes/wallet/withdraw.js'
import { mpesaWebhookRoutes } from './routes/webhooks/mpesa.js'
import { mtnWebhookRoutes } from './routes/webhooks/mtn.js'
import { airtelWebhookRoutes } from './routes/webhooks/airtel.js'
import { stubWebhookRoutes } from './routes/webhooks/stub.js'
import { providerBalanceRoutes } from './routes/provider/balance.js'
import { providerDebitRoutes } from './routes/provider/debit.js'
import { providerCreditRoutes } from './routes/provider/credit.js'
import { providerRollbackRoutes } from './routes/provider/rollback.js'

export function buildServer() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  app.register(cors, { origin: process.env.CORS_ORIGIN ?? true, credentials: true })
  app.register(cookie)

  app.register(healthRoutes)
  app.register(registerRoutes)
  app.register(verifyOtpRoutes)
  app.register(loginRoutes)
  app.register(refreshRoutes)
  app.register(logoutRoutes)
  app.register(adminAuthRoutes)
  app.register(playerMeRoutes)

  app.register(walletBalanceRoutes)
  app.register(walletDepositRoutes)
  app.register(walletWithdrawRoutes)

  app.register(mpesaWebhookRoutes)
  app.register(mtnWebhookRoutes)
  app.register(airtelWebhookRoutes)
  app.register(stubWebhookRoutes)

  app.register(providerBalanceRoutes)
  app.register(providerDebitRoutes)
  app.register(providerCreditRoutes)
  app.register(providerRollbackRoutes)

  app.setErrorHandler((error, _req, reply) => {
    const statusCode = error.statusCode ?? 500
    reply.status(statusCode).send({
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: statusCode >= 500 ? 'Internal server error' : error.message,
      },
    })
  })

  return app
}
```

Note: `@fastify/jwt` removed — Phase 2's `lib/jwt.ts` (jsonwebtoken) handles all JWT.

- [ ] **Step 4: Resolve index.ts — keep Phase 3a cron**

Write `apps/api/src/index.ts`:
```typescript
import { runMigrations } from '@betting/db'
import { buildServer } from './server.js'
import { env } from './env.js'
import { startCron } from './lib/cron.js'

async function main() {
  await runMigrations()

  const app = buildServer()
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  app.log.info(`API server listening on port ${env.PORT}`)

  startCron()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

(Socket.io + crash loop added in Task 7)

- [ ] **Step 5: Resolve package.json — union of Phase 2 + Phase 3a deps**

Write `apps/api/package.json`:
```json
{
  "name": "api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@betting/db": "workspace:*",
    "@betting/types": "workspace:*",
    "@fastify/cookie": "^9.3.1",
    "@fastify/cors": "^9.0.1",
    "africastalking": "^0.7.9",
    "bcryptjs": "^3.0.3",
    "fastify": "^4.27.0",
    "ioredis": "^5.10.1",
    "jsonwebtoken": "^9.0.3",
    "node-cron": "^4.2.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/bcryptjs": "^3.0.0",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/node": "^20.14.0",
    "@types/node-cron": "^3.0.11",
    "tsx": "^4.15.7",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 6: Install, test, commit**

```bash
git add -A
git merge --continue
pnpm install
pnpm --filter api test
git add -A
git commit -m "chore: merge feature/phase-2 into master"
```

Expected: all existing tests pass

---

## Task 2: Add socket.io dependencies

**Files:** `apps/api/package.json`, `apps/web/package.json`

- [ ] **Step 1: Add packages**

```bash
pnpm --filter api add socket.io
pnpm --filter web add socket.io-client
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/package.json apps/web/package.json pnpm-lock.yaml
git commit -m "chore: add socket.io to api and web"
```

---

## Task 3: Database migrations

**Files:** `packages/db/migrations/011_game_settings.sql`, `012_bets_game_type.sql`

- [ ] **Step 1: Create 011_game_settings.sql**

Write `packages/db/migrations/011_game_settings.sql`:
```sql
CREATE TABLE game_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      JSONB        NOT NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO game_settings (key, value) VALUES
  ('crash_house_edge',      '5'),
  ('crash_waiting_seconds', '5'),
  ('mines_house_edge',      '5'),
  ('dice_house_edge',       '1');
```

- [ ] **Step 2: Create 012_bets_game_type.sql**

Write `packages/db/migrations/012_bets_game_type.sql`:
```sql
ALTER TABLE bets
  DROP CONSTRAINT bets_game_type_check,
  ADD CONSTRAINT bets_game_type_check
    CHECK (game_type IN ('crash', 'mines', 'dice', 'slot', 'virtual_sport'));
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/
git commit -m "feat: add game_settings table and extend bets.game_type for mines/dice"
```

---

## Task 4: Crash RNG module

**Files:** `apps/api/src/lib/crash-rng.ts`, `apps/api/src/lib/crash-rng.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/lib/crash-rng.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { generateCrashPoint, generateMinePositions, rollDiceResult } from './crash-rng.js'

const SERVER = 'test-server-seed-fixed-value-for-tests'
const CLIENT = 'test-client-seed'

describe('generateCrashPoint', () => {
  it('returns a number >= 1.00', () => {
    expect(generateCrashPoint(SERVER, CLIENT, 1, 5)).toBeGreaterThanOrEqual(1.00)
  })

  it('is deterministic', () => {
    expect(generateCrashPoint(SERVER, CLIENT, 42, 5)).toBe(generateCrashPoint(SERVER, CLIENT, 42, 5))
  })

  it('produces variety across round numbers', () => {
    const values = new Set(Array.from({ length: 30 }, (_, i) => generateCrashPoint(SERVER, CLIENT, i, 5)))
    expect(values.size).toBeGreaterThan(5)
  })
})

describe('generateMinePositions', () => {
  it('returns exactly mineCount positions', () => {
    expect(generateMinePositions(SERVER, CLIENT, 'g1', 9, 3)).toHaveLength(3)
  })

  it('all positions are within [0, totalTiles-1]', () => {
    const pos = generateMinePositions(SERVER, CLIENT, 'g1', 25, 5)
    for (const p of pos) {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(25)
    }
  })

  it('positions are sorted ascending', () => {
    const pos = generateMinePositions(SERVER, CLIENT, 'g1', 25, 5)
    for (let i = 1; i < pos.length; i++) expect(pos[i]).toBeGreaterThan(pos[i - 1])
  })

  it('is deterministic', () => {
    expect(generateMinePositions(SERVER, CLIENT, 'gx', 9, 2))
      .toEqual(generateMinePositions(SERVER, CLIENT, 'gx', 9, 2))
  })
})

describe('rollDiceResult', () => {
  it('returns value in [0, 99]', () => {
    const r = rollDiceResult(SERVER, CLIENT, 1)
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThan(100)
  })

  it('is deterministic', () => {
    expect(rollDiceResult(SERVER, CLIENT, 7)).toBe(rollDiceResult(SERVER, CLIENT, 7))
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter api test -- --reporter=verbose crash-rng
```

Expected: FAIL — "Cannot find module './crash-rng.js'"

- [ ] **Step 3: Implement crash-rng.ts**

Create `apps/api/src/lib/crash-rng.ts`:
```typescript
import { createHmac } from 'crypto'

export function generateCrashPoint(
  serverSeed: string,
  clientSeed: string,
  roundNumber: number,
  houseEdge: number,
): number {
  const hash = createHmac('sha256', serverSeed)
    .update(`${clientSeed}-${roundNumber}`)
    .digest('hex')

  if (hash[0] === '0') return 1.00

  const n = parseInt(hash.slice(0, 13), 16)
  const e = 100 - houseEdge
  return Math.max(1.00, Math.floor((e / (1 - n / 2 ** 52)) / 100) / 100)
}

export function generateMinePositions(
  serverSeed: string,
  clientSeed: string,
  gameId: string,
  totalTiles: number,
  mineCount: number,
): number[] {
  const tiles = Array.from({ length: totalTiles }, (_, i) => i)

  for (let i = totalTiles - 1; i > 0; i--) {
    const hash = createHmac('sha256', serverSeed)
      .update(`${clientSeed}-${gameId}-${i}`)
      .digest('hex')
    const j = parseInt(hash.slice(0, 8), 16) % (i + 1)
    ;[tiles[i], tiles[j]] = [tiles[j], tiles[i]]
  }

  return tiles.slice(0, mineCount).sort((a, b) => a - b)
}

export function rollDiceResult(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): number {
  const hash = createHmac('sha256', serverSeed)
    .update(`${clientSeed}-${nonce}`)
    .digest('hex')
  return parseInt(hash.slice(0, 8), 16) % 100
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter api test -- --reporter=verbose crash-rng
```

Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/crash-rng.ts apps/api/src/lib/crash-rng.test.ts
git commit -m "feat: provably fair RNG for crash, mines, and dice"
```

---

## Task 5: Crash service

**Files:** `apps/api/src/services/crash.service.ts`, `apps/api/src/services/crash.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/services/crash.service.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))

import { pool } from '@betting/db'
import { placeBet, cashout, settleLostBets } from './crash.service.js'

const mockConnect = vi.mocked(pool.connect)

function makeMockClient(rows: any[][] = []) {
  let i = 0
  return {
    query: vi.fn(async () => { const r = rows[i] ?? []; i++; return { rows: r } }),
    release: vi.fn(),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('placeBet', () => {
  it('debits wallet, inserts bet row, returns betId', async () => {
    const client = makeMockClient([
      [{ id: 'w-1', balance: '50000', currency: 'KES' }], // selectWalletForUpdate
      [{ balance: '40000' }],                              // UPDATE wallets
      [{ id: 'tx-1' }],                                   // INSERT transactions
      [{ id: 'bet-1', effective_stake: '10000' }],        // INSERT bets
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await placeBet('p-1', 'round-1', 10000, undefined)
    expect(result.betId).toBe('bet-1')
    expect(result.effectiveStake).toBe(10000)
  })

  it('throws INSUFFICIENT_FUNDS when balance too low', async () => {
    const client = makeMockClient([[{ id: 'w-1', balance: '500', currency: 'KES' }]])
    mockConnect.mockResolvedValueOnce(client as any)

    await expect(placeBet('p-1', 'round-1', 10000, undefined))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' })
    expect(client.release).toHaveBeenCalled()
  })
})

describe('cashout', () => {
  it('credits winnings, marks bet won, returns winnings', async () => {
    const client = makeMockClient([
      [{ id: 'bet-1', effective_stake: '10000', status: 'active' }], // SELECT bet FOR UPDATE
      [{ id: 'w-1', balance: '0', currency: 'KES' }],               // selectWalletForUpdate
      [{ balance: '20000' }],                                        // UPDATE wallets balance
      [{ id: 'tx-2' }],                                             // INSERT transactions
      [{}],                                                          // UPDATE wallets locked_balance
      [{}],                                                          // UPDATE bets
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await cashout('p-1', 'bet-1', 2.00)
    expect(result.winnings).toBe(20000)
  })

  it('throws BET_NOT_FOUND when bet not active', async () => {
    const client = makeMockClient([[]])
    mockConnect.mockResolvedValueOnce(client as any)

    await expect(cashout('p-1', 'bet-999', 2.00))
      .rejects.toMatchObject({ code: 'BET_NOT_FOUND' })
  })
})

describe('settleLostBets', () => {
  it('marks active bets as lost and decrements locked_balance', async () => {
    const client = makeMockClient([
      [
        { id: 'bet-1', player_id: 'p-1', effective_stake: '10000' },
        { id: 'bet-2', player_id: 'p-2', effective_stake: '5000' },
      ],
      [{}], // UPDATE bets lost
      [{}], // UPDATE wallets p-1 locked
      [{}], // UPDATE wallets p-2 locked
      [{}], // UPDATE game_rounds
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    await settleLostBets('round-1', 'revealed-seed', 1.23)

    const betCall = client.query.mock.calls[1] as unknown as [string, unknown[]]
    expect(betCall[0]).toContain("status = 'lost'")
  })

  it('still updates game_round when no active bets', async () => {
    const client = makeMockClient([[], [{}]])
    mockConnect.mockResolvedValueOnce(client as any)

    await expect(settleLostBets('round-1', 'seed', 1.00)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter api test -- --reporter=verbose crash.service
```

Expected: FAIL — "Cannot find module './crash.service.js'"

- [ ] **Step 3: Implement crash.service.ts**

Create `apps/api/src/services/crash.service.ts`:
```typescript
import { pool } from '@betting/db'
import { debitForBet, creditWinnings } from './wallet.service.js'
import { AppError } from '../lib/errors.js'

export interface PlacedBet {
  betId: string
  effectiveStake: number
}

export async function placeBet(
  playerId: string,
  roundId: string,
  grossStake: number,
  autoCashoutAt: number | undefined,
): Promise<PlacedBet> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { walletId } = await debitForBet(client, playerId, grossStake, grossStake, {
      game: 'crash', roundId,
    })
    const { rows } = await client.query<{ id: string; effective_stake: string }>(
      `INSERT INTO bets (player_id, wallet_id, round_id, game_type, gross_stake, wager_tax, effective_stake, auto_cashout_at)
       VALUES ($1, $2, $3, 'crash', $4, 0, $5, $6)
       RETURNING id, effective_stake`,
      [playerId, walletId, roundId, grossStake, grossStake, autoCashoutAt ?? null],
    )
    await client.query('COMMIT')
    return { betId: rows[0].id, effectiveStake: Number(rows[0].effective_stake) }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function cashout(
  playerId: string,
  betId: string,
  multiplier: number,
): Promise<{ winnings: number }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ id: string; effective_stake: string }>(
      `SELECT id, effective_stake FROM bets
       WHERE id = $1 AND player_id = $2 AND status = 'active' FOR UPDATE`,
      [betId, playerId],
    )
    if (rows.length === 0) throw new AppError('BET_NOT_FOUND', 'Active bet not found', 404)

    const effectiveStake = Number(rows[0].effective_stake)
    const winnings = Math.floor(effectiveStake * multiplier)

    await creditWinnings(client, playerId, winnings, { game: 'crash', betId, multiplier })
    await client.query(
      `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
      [effectiveStake, playerId],
    )
    await client.query(
      `UPDATE bets SET status = 'won', cashout_multiplier = $1, winnings = $2, settled_at = NOW() WHERE id = $3`,
      [multiplier, winnings, betId],
    )
    await client.query('COMMIT')
    return { winnings }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function settleLostBets(
  roundId: string,
  serverSeed: string,
  crashPoint: number,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: activeBets } = await client.query<{
      id: string; player_id: string; effective_stake: string
    }>(
      `SELECT id, player_id, effective_stake FROM bets WHERE round_id = $1 AND status = 'active'`,
      [roundId],
    )
    if (activeBets.length > 0) {
      const betIds = activeBets.map(b => b.id)
      await client.query(
        `UPDATE bets SET status = 'lost', settled_at = NOW() WHERE id = ANY($1)`,
        [betIds],
      )
      for (const bet of activeBets) {
        await client.query(
          `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
          [Number(bet.effective_stake), bet.player_id],
        )
      }
    }
    await client.query(
      `UPDATE game_rounds
       SET status = 'crashed', server_seed = $1, crash_point = $2, crashed_at = NOW()
       WHERE id = $3`,
      [serverSeed, crashPoint, roundId],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getHouseEdge(key: string): Promise<number> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM game_settings WHERE key = $1`, [key],
  )
  return rows.length === 0 ? 5 : Number(rows[0].value)
}

export async function getRecentRounds(limit = 20): Promise<Array<{
  roundNumber: number; crashPoint: number; createdAt: string
}>> {
  const { rows } = await pool.query(
    `SELECT round_number, crash_point, created_at FROM game_rounds
     WHERE status = 'crashed' ORDER BY round_number DESC LIMIT $1`,
    [limit],
  )
  return rows.map(r => ({
    roundNumber: Number(r.round_number),
    crashPoint: Number(r.crash_point),
    createdAt: r.created_at,
  }))
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter api test -- --reporter=verbose crash.service
```

Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/crash.service.ts apps/api/src/services/crash.service.test.ts
git commit -m "feat: crash service — placeBet, cashout, settleLostBets"
```

---

## Task 6: Crash game loop

**Files:** `apps/api/src/game/crash-loop.ts`

- [ ] **Step 1: Create the game directory and implement crash-loop.ts**

Create `apps/api/src/game/crash-loop.ts`:
```typescript
import { randomBytes, createHash } from 'crypto'
import type { Server } from 'socket.io'
import { getRedis } from '../lib/redis.js'
import { pool } from '@betting/db'
import { generateCrashPoint } from '../lib/crash-rng.js'
import { settleLostBets, getHouseEdge, cashout } from '../services/crash.service.js'

const ROUND_KEY = 'crash:round:current'
const WAITING_MS = 5000
const POST_CRASH_MS = 2000

export interface CrashRoundState {
  roundId: string
  roundNumber: number
  status: 'waiting' | 'running' | 'crashed'
  serverSeed: string
  serverSeedHash: string
  clientSeed: string
  crashPoint: number
  multiplier: number
  waitingEndsAt: number
  startedAt: number
  bets: Record<string, { betId: string; effectiveStake: number; autoCashoutAt?: number }>
}

let currentRound: CrashRoundState | null = null
let tickRunning = false
let intervalId: ReturnType<typeof setInterval> | null = null

export function startCrashLoop(io: Server): void {
  intervalId = setInterval(() => {
    tick(io).catch(err => console.error('[crash-loop] tick error', err))
  }, 100)
}

export function stopCrashLoop(): void {
  if (intervalId) clearInterval(intervalId)
  intervalId = null
  currentRound = null
}

export function addBetToRound(
  playerId: string,
  betId: string,
  effectiveStake: number,
  autoCashoutAt?: number,
): void {
  if (!currentRound || currentRound.status !== 'waiting') return
  currentRound.bets[playerId] = { betId, effectiveStake, autoCashoutAt }
  getRedis().set(ROUND_KEY, JSON.stringify(currentRound))
}

export function removeBetFromRound(playerId: string): void {
  if (!currentRound) return
  delete currentRound.bets[playerId]
}

export function getCurrentRound(): CrashRoundState | null {
  return currentRound
}

async function tick(io: Server): Promise<void> {
  if (tickRunning) return
  tickRunning = true
  try {
    if (!currentRound) {
      await initRound()
      return
    }

    const now = Date.now()

    if (currentRound.status === 'waiting') {
      if (now >= currentRound.waitingEndsAt) {
        await transitionToRunning(io)
      }
      return
    }

    if (currentRound.status === 'running') {
      const elapsedSec = (now - currentRound.startedAt) / 1000
      const multiplier = Math.max(1.00, Math.floor(Math.exp(elapsedSec * 0.1) * 100) / 100)
      currentRound.multiplier = multiplier

      for (const [playerId, bet] of Object.entries(currentRound.bets)) {
        if (bet.autoCashoutAt && multiplier >= bet.autoCashoutAt) {
          try {
            const { winnings } = await cashout(playerId, bet.betId, multiplier)
            removeBetFromRound(playerId)
            io.to('crash').emit('cashout:broadcast', { playerId, multiplier, winnings })
          } catch (err) {
            console.error('[crash-loop] auto-cashout failed', err)
          }
        }
      }

      io.to('crash').emit('round:tick', { multiplier })

      if (multiplier >= currentRound.crashPoint) {
        await transitionToCrashed(io)
      }
    }
  } finally {
    tickRunning = false
  }
}

async function initRound(): Promise<void> {
  const redis = getRedis()
  const existing = await redis.get(ROUND_KEY)
  if (existing) {
    const state = JSON.parse(existing) as CrashRoundState
    if (state.status === 'running') {
      await settleLostBets(state.roundId, state.serverSeed, state.crashPoint)
      await redis.del(ROUND_KEY)
    } else if (state.status === 'waiting') {
      currentRound = state
      return
    }
  }
  await createNewRound()
}

async function createNewRound(): Promise<void> {
  const serverSeed = randomBytes(32).toString('hex')
  const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex')
  const clientSeed = randomBytes(16).toString('hex')
  const houseEdge = await getHouseEdge('crash_house_edge')

  const { rows } = await pool.query<{ id: string; round_number: string }>(
    `INSERT INTO game_rounds (server_seed_hash, client_seed, status)
     VALUES ($1, $2, 'waiting') RETURNING id, round_number`,
    [serverSeedHash, clientSeed],
  )

  const roundId = rows[0].id
  const roundNumber = Number(rows[0].round_number)
  const crashPoint = generateCrashPoint(serverSeed, clientSeed, roundNumber, houseEdge)

  currentRound = {
    roundId, roundNumber, status: 'waiting',
    serverSeed, serverSeedHash, clientSeed, crashPoint,
    multiplier: 1.00, waitingEndsAt: Date.now() + WAITING_MS, startedAt: 0, bets: {},
  }
  await getRedis().set(ROUND_KEY, JSON.stringify(currentRound))
}

async function transitionToRunning(io: Server): Promise<void> {
  if (!currentRound) return
  currentRound.status = 'running'
  currentRound.startedAt = Date.now()
  await pool.query(
    `UPDATE game_rounds SET status = 'running', started_at = NOW() WHERE id = $1`,
    [currentRound.roundId],
  )
  await getRedis().set(ROUND_KEY, JSON.stringify(currentRound))
  io.to('crash').emit('round:started', {
    roundId: currentRound.roundId,
    roundNumber: currentRound.roundNumber,
    serverSeedHash: currentRound.serverSeedHash,
    clientSeed: currentRound.clientSeed,
  })
}

async function transitionToCrashed(io: Server): Promise<void> {
  if (!currentRound) return
  const { roundId, serverSeed, crashPoint } = currentRound
  currentRound.status = 'crashed'
  await settleLostBets(roundId, serverSeed, crashPoint)
  await getRedis().del(ROUND_KEY)
  io.to('crash').emit('round:crashed', { crashPoint, serverSeed, roundId })
  currentRound = null
  setTimeout(() => createNewRound(), POST_CRASH_MS)
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/game/crash-loop.ts
git commit -m "feat: crash game loop — 100ms tick, WAITING→RUNNING→CRASHED state machine"
```

---

## Task 7: Socket.io integration

**Files:** `apps/api/src/game/crash-socket.ts`, `apps/api/src/game/crash-socket.test.ts`, `apps/api/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/game/crash-socket.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/crash.service.js', () => ({
  placeBet: vi.fn(),
  cashout: vi.fn(),
}))
vi.mock('./crash-loop.js', () => ({
  addBetToRound: vi.fn(),
  removeBetFromRound: vi.fn(),
  getCurrentRound: vi.fn(),
}))

import { placeBet, cashout } from '../services/crash.service.js'
import { addBetToRound, removeBetFromRound, getCurrentRound } from './crash-loop.js'
import { handleCrashSocket } from './crash-socket.js'

function makeSocket(playerId = 'player-1') {
  const handlers: Record<string, Function> = {}
  return {
    data: { playerId },
    on: vi.fn((event: string, fn: Function) => { handlers[event] = fn }),
    emit: vi.fn(),
    join: vi.fn(),
    _trigger: async (event: string, data?: any) => handlers[event]?.(data),
  }
}

function makeIo() {
  const roomEmit = vi.fn()
  return { to: vi.fn().mockReturnValue({ emit: roomEmit }), _roomEmit: roomEmit }
}

beforeEach(() => vi.clearAllMocks())

describe('bet:place', () => {
  it('places bet and emits bet:confirmed on success', async () => {
    vi.mocked(getCurrentRound).mockReturnValue({ status: 'waiting', roundId: 'r-1', bets: {} } as any)
    vi.mocked(placeBet).mockResolvedValueOnce({ betId: 'bet-1', effectiveStake: 10000 })

    const socket = makeSocket()
    const io = makeIo()
    handleCrashSocket(io as any, socket as any)

    await socket._trigger('bet:place', { grossStake: 10000 })

    expect(placeBet).toHaveBeenCalledWith('player-1', 'r-1', 10000, undefined)
    expect(socket.emit).toHaveBeenCalledWith('bet:confirmed', expect.objectContaining({ betId: 'bet-1' }))
  })

  it('emits bet:error when round is not waiting', async () => {
    vi.mocked(getCurrentRound).mockReturnValue({ status: 'running', roundId: 'r-1', bets: {} } as any)

    const socket = makeSocket()
    handleCrashSocket(makeIo() as any, socket as any)
    await socket._trigger('bet:place', { grossStake: 10000 })

    expect(placeBet).not.toHaveBeenCalled()
    expect(socket.emit).toHaveBeenCalledWith('bet:error', expect.objectContaining({ code: 'ROUND_NOT_WAITING' }))
  })
})

describe('bet:cashout', () => {
  it('cashes out and emits cashout:confirmed + cashout:broadcast', async () => {
    vi.mocked(getCurrentRound).mockReturnValue({
      status: 'running', multiplier: 2.50,
      bets: { 'player-1': { betId: 'bet-1', effectiveStake: 10000 } },
    } as any)
    vi.mocked(cashout).mockResolvedValueOnce({ winnings: 25000 })

    const socket = makeSocket()
    const io = makeIo()
    handleCrashSocket(io as any, socket as any)
    await socket._trigger('bet:cashout')

    expect(cashout).toHaveBeenCalledWith('player-1', 'bet-1', 2.50)
    expect(socket.emit).toHaveBeenCalledWith('cashout:confirmed', { multiplier: 2.50, winnings: 25000 })
    expect(io._roomEmit).toHaveBeenCalledWith('cashout:broadcast', expect.objectContaining({ multiplier: 2.50 }))
  })

  it('emits bet:error when player has no active bet', async () => {
    vi.mocked(getCurrentRound).mockReturnValue({ status: 'running', multiplier: 1.5, bets: {} } as any)

    const socket = makeSocket()
    handleCrashSocket(makeIo() as any, socket as any)
    await socket._trigger('bet:cashout')

    expect(socket.emit).toHaveBeenCalledWith('bet:error', expect.objectContaining({ code: 'NO_ACTIVE_BET' }))
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter api test -- --reporter=verbose crash-socket
```

Expected: FAIL — "Cannot find module './crash-socket.js'"

- [ ] **Step 3: Implement crash-socket.ts**

Create `apps/api/src/game/crash-socket.ts`:
```typescript
import type { Server, Socket } from 'socket.io'
import { verifyPlayerAccessToken } from '../lib/jwt.js'
import { placeBet, cashout } from '../services/crash.service.js'
import { addBetToRound, removeBetFromRound, getCurrentRound } from './crash-loop.js'

export function registerCrashSocket(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) { socket.disconnect(); return }

    try {
      const payload = verifyPlayerAccessToken(token)
      socket.data.playerId = payload.sub
    } catch {
      socket.disconnect()
      return
    }

    socket.join('crash')
    handleCrashSocket(io, socket)
  })
}

export function handleCrashSocket(io: Server, socket: Socket): void {
  socket.on('bet:place', async (data: { grossStake: number; autoCashoutAt?: number }) => {
    const playerId: string = socket.data.playerId
    const round = getCurrentRound()

    if (!round || round.status !== 'waiting') {
      socket.emit('bet:error', { code: 'ROUND_NOT_WAITING', message: 'No waiting round' })
      return
    }
    if (round.bets[playerId]) {
      socket.emit('bet:error', { code: 'BET_ALREADY_PLACED', message: 'Already bet this round' })
      return
    }

    try {
      const bet = await placeBet(playerId, round.roundId, data.grossStake, data.autoCashoutAt)
      addBetToRound(playerId, bet.betId, bet.effectiveStake, data.autoCashoutAt)
      socket.emit('bet:confirmed', { betId: bet.betId, effectiveStake: bet.effectiveStake })
    } catch (err: any) {
      socket.emit('bet:error', { code: err.code ?? 'BET_FAILED', message: err.message })
    }
  })

  socket.on('bet:cashout', async () => {
    const playerId: string = socket.data.playerId
    const round = getCurrentRound()

    if (!round || round.status !== 'running') {
      socket.emit('bet:error', { code: 'ROUND_NOT_RUNNING', message: 'Round not running' })
      return
    }
    const bet = round.bets[playerId]
    if (!bet) {
      socket.emit('bet:error', { code: 'NO_ACTIVE_BET', message: 'No active bet' })
      return
    }

    try {
      const { winnings } = await cashout(playerId, bet.betId, round.multiplier)
      removeBetFromRound(playerId)
      socket.emit('cashout:confirmed', { multiplier: round.multiplier, winnings })
      io.to('crash').emit('cashout:broadcast', { playerId, multiplier: round.multiplier, winnings })
    } catch (err: any) {
      socket.emit('bet:error', { code: err.code ?? 'CASHOUT_FAILED', message: err.message })
    }
  })
}
```

- [ ] **Step 4: Update index.ts to wire Socket.io after app.listen()**

Write `apps/api/src/index.ts`:
```typescript
import { runMigrations } from '@betting/db'
import { buildServer } from './server.js'
import { env } from './env.js'
import { startCron } from './lib/cron.js'
import { Server } from 'socket.io'
import { registerCrashSocket } from './game/crash-socket.js'
import { startCrashLoop } from './game/crash-loop.js'

async function main() {
  await runMigrations()

  const app = buildServer()
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  app.log.info(`API server listening on port ${env.PORT}`)

  startCron()

  const io = new Server(app.server, {
    cors: { origin: process.env.CORS_ORIGIN ?? '*', credentials: true },
  })
  registerCrashSocket(io)
  startCrashLoop(io)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 5: Run all tests**

```bash
pnpm --filter api test -- --reporter=verbose crash-socket
pnpm --filter api test
```

Expected: crash-socket 4 tests PASS, full suite passes

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/game/ apps/api/src/index.ts
git commit -m "feat: crash Socket.io handlers and loop startup"
```

---

## Task 8: Mines service + routes

**Files:** `apps/api/src/services/mines.service.ts`, `apps/api/src/services/mines.service.test.ts`, `apps/api/src/routes/games/mines.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/services/mines.service.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('../lib/redis.js', () => ({ getRedis: vi.fn() }))
vi.mock('../lib/crash-rng.js', () => ({ generateMinePositions: vi.fn(() => [2, 5]) }))
vi.mock('./wallet.service.js', () => ({
  debitForBet: vi.fn(async () => ({ transactionId: 'tx-1', walletId: 'w-1' })),
  creditWinnings: vi.fn(async () => ({ transactionId: 'tx-2', walletId: 'w-1' })),
}))
vi.mock('./crash.service.js', () => ({ getHouseEdge: vi.fn(async () => 5) }))

import { pool } from '@betting/db'
import { getRedis } from '../lib/redis.js'
import { creditWinnings } from './wallet.service.js'
import { startGame, revealTile, cashoutMines } from './mines.service.js'

const mockConnect = vi.mocked(pool.connect)
const mockRedis = { get: vi.fn(), setex: vi.fn(), del: vi.fn() }

function makeMockClient(rows: any[][] = []) {
  let i = 0
  return {
    query: vi.fn(async () => { const r = rows[i] ?? []; i++; return { rows: r } }),
    release: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRedis).mockReturnValue(mockRedis as any)
  mockRedis.get.mockResolvedValue(null)
})

const activeGame = {
  gameId: 'g-1', playerId: 'p-1', gridSize: 3, mineCount: 2,
  minePositions: [2, 5], serverSeed: 'seed', serverSeedHash: 'hash',
  clientSeed: 'client', revealedTiles: [], effectiveStake: 10000,
  currentMultiplier: 0.95, status: 'active', betId: 'bet-1',
}

describe('startGame', () => {
  it('stores game state in Redis and returns gameId', async () => {
    const client = makeMockClient([[{ id: 'bet-1' }]])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await startGame('p-1', 10000, 3, 2)

    expect(mockRedis.setex).toHaveBeenCalled()
    expect(result.gridSize).toBe(3)
    expect(result.mineCount).toBe(2)
    expect(result.serverSeedHash).toBeDefined()
  })

  it('throws GAME_ALREADY_ACTIVE when player has active game', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify({ ...activeGame, status: 'active' }))
    await expect(startGame('p-1', 10000, 3, 2)).rejects.toMatchObject({ code: 'GAME_ALREADY_ACTIVE' })
  })
})

describe('revealTile', () => {
  it('returns safe:true and updated multiplier for a safe tile', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(activeGame))
    const result = await revealTile('p-1', 'g-1', 0)
    expect(result.safe).toBe(true)
    expect(result.multiplier).toBeGreaterThan(1.0)
  })

  it('returns safe:false and mine positions when hitting a mine', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(activeGame))
    const client = makeMockClient([[{}], [{}]])
    mockConnect.mockResolvedValueOnce(client as any)
    const result = await revealTile('p-1', 'g-1', 2)
    expect(result.safe).toBe(false)
    expect(result.minePositions).toEqual([2, 5])
    expect(mockRedis.del).toHaveBeenCalled()
  })
})

describe('cashoutMines', () => {
  it('credits winnings and returns mine positions + serverSeed', async () => {
    const game = { ...activeGame, revealedTiles: [0, 1], currentMultiplier: 1.35 }
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(game))
    const client = makeMockClient([[{}], [{}]])
    mockConnect.mockResolvedValueOnce(client as any)
    const result = await cashoutMines('p-1', 'g-1')
    expect(result.winnings).toBe(13500)
    expect(result.minePositions).toEqual([2, 5])
    expect(creditWinnings).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter api test -- --reporter=verbose mines.service
```

Expected: FAIL — "Cannot find module './mines.service.js'"

- [ ] **Step 3: Implement mines.service.ts**

Create `apps/api/src/services/mines.service.ts`:
```typescript
import { randomBytes, createHash } from 'crypto'
import { pool } from '@betting/db'
import { getRedis } from '../lib/redis.js'
import { debitForBet, creditWinnings } from './wallet.service.js'
import { generateMinePositions } from '../lib/crash-rng.js'
import { getHouseEdge } from './crash.service.js'
import { AppError } from '../lib/errors.js'

const GAME_TTL = 1800

interface MinesGameState {
  gameId: string; playerId: string; gridSize: number; mineCount: number
  minePositions: number[]; serverSeed: string; serverSeedHash: string
  clientSeed: string; revealedTiles: number[]; effectiveStake: number
  currentMultiplier: number; status: 'active' | 'won' | 'lost'; betId: string
}

const redisKey = (playerId: string) => `mines:player:${playerId}`

function nextMultiplier(cur: number, safe: number, total: number, revealed: number): number {
  const pSafe = (safe - revealed) / (total - revealed)
  return Math.floor((cur / pSafe) * 100) / 100
}

export async function startGame(
  playerId: string, grossStake: number, gridSize: number, mineCount: number,
): Promise<{ gameId: string; serverSeedHash: string; clientSeed: string; gridSize: number; mineCount: number }> {
  const redis = getRedis()
  const existing = await redis.get(redisKey(playerId))
  if (existing && (JSON.parse(existing) as MinesGameState).status === 'active') {
    throw new AppError('GAME_ALREADY_ACTIVE', 'You already have an active mines game', 422)
  }

  const totalTiles = gridSize * gridSize
  if (mineCount < 1 || mineCount >= totalTiles) {
    throw new AppError('INVALID_MINE_COUNT', 'Invalid mine count', 400)
  }

  const serverSeed = randomBytes(32).toString('hex')
  const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex')
  const clientSeed = randomBytes(16).toString('hex')
  const gameId = randomBytes(16).toString('hex')
  const houseEdge = await getHouseEdge('mines_house_edge')
  const minePositions = generateMinePositions(serverSeed, clientSeed, gameId, totalTiles, mineCount)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { walletId } = await debitForBet(client, playerId, grossStake, grossStake, { game: 'mines', gameId })
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO bets (player_id, wallet_id, game_type, gross_stake, wager_tax, effective_stake)
       VALUES ($1, $2, 'mines', $3, 0, $4) RETURNING id`,
      [playerId, walletId, grossStake, grossStake],
    )
    await client.query('COMMIT')

    const state: MinesGameState = {
      gameId, playerId, gridSize, mineCount, minePositions,
      serverSeed, serverSeedHash, clientSeed, revealedTiles: [],
      effectiveStake: grossStake, currentMultiplier: 1 - houseEdge / 100,
      status: 'active', betId: rows[0].id,
    }
    await redis.setex(redisKey(playerId), GAME_TTL, JSON.stringify(state))
    return { gameId, serverSeedHash, clientSeed, gridSize, mineCount }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function revealTile(
  playerId: string, gameId: string, tileIndex: number,
): Promise<{ safe: boolean; multiplier?: number; minePositions?: number[] }> {
  const redis = getRedis()
  const raw = await redis.get(redisKey(playerId))
  if (!raw) throw new AppError('GAME_NOT_FOUND', 'No active mines game', 404)

  const state = JSON.parse(raw) as MinesGameState
  if (state.gameId !== gameId || state.status !== 'active') {
    throw new AppError('GAME_NOT_FOUND', 'No active mines game', 404)
  }
  if (state.revealedTiles.includes(tileIndex)) {
    throw new AppError('TILE_ALREADY_REVEALED', 'Tile already revealed', 400)
  }

  if (state.minePositions.includes(tileIndex)) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
        [state.effectiveStake, playerId],
      )
      await client.query(
        `UPDATE bets SET status = 'lost', settled_at = NOW() WHERE id = $1`, [state.betId],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    await redis.del(redisKey(playerId))
    return { safe: false, minePositions: state.minePositions }
  }

  const totalTiles = state.gridSize * state.gridSize
  const safeTiles = totalTiles - state.mineCount
  const newMultiplier = nextMultiplier(state.currentMultiplier, safeTiles, totalTiles, state.revealedTiles.length)
  state.revealedTiles.push(tileIndex)
  state.currentMultiplier = newMultiplier
  await redis.setex(redisKey(playerId), GAME_TTL, JSON.stringify(state))
  return { safe: true, multiplier: newMultiplier }
}

export async function cashoutMines(
  playerId: string, gameId: string,
): Promise<{ winnings: number; minePositions: number[]; serverSeed: string }> {
  const redis = getRedis()
  const raw = await redis.get(redisKey(playerId))
  if (!raw) throw new AppError('GAME_NOT_FOUND', 'No active mines game', 404)

  const state = JSON.parse(raw) as MinesGameState
  if (state.gameId !== gameId || state.status !== 'active') {
    throw new AppError('GAME_NOT_FOUND', 'No active mines game', 404)
  }
  if (state.revealedTiles.length === 0) {
    throw new AppError('NO_TILES_REVEALED', 'Reveal at least one tile before cashing out', 400)
  }

  const winnings = Math.floor(state.effectiveStake * state.currentMultiplier)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await creditWinnings(client, playerId, winnings, { game: 'mines', gameId, multiplier: state.currentMultiplier })
    await client.query(
      `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
      [state.effectiveStake, playerId],
    )
    await client.query(
      `UPDATE bets SET status = 'won', cashout_multiplier = $1, winnings = $2, settled_at = NOW() WHERE id = $3`,
      [state.currentMultiplier, winnings, state.betId],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  await redis.del(redisKey(playerId))
  return { winnings, minePositions: state.minePositions, serverSeed: state.serverSeed }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter api test -- --reporter=verbose mines.service
```

Expected: 5 tests PASS

- [ ] **Step 5: Implement mines routes**

Create `apps/api/src/routes/games/mines.ts`:
```typescript
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { startGame, revealTile, cashoutMines } from '../../services/mines.service.js'
import { AppError } from '../../lib/errors.js'

export async function minesRoutes(app: FastifyInstance) {
  app.post('/games/mines/start', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({
      grossStake: z.number().int().positive(),
      gridSize: z.number().int().min(3).max(5),
      mineCount: z.number().int().min(1),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    try {
      return reply.status(201).send(await startGame(req.playerId, parsed.data.grossStake, parsed.data.gridSize, parsed.data.mineCount))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  app.post('/games/mines/reveal', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ gameId: z.string().min(1), tileIndex: z.number().int().min(0) }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    try {
      return reply.send(await revealTile(req.playerId, parsed.data.gameId, parsed.data.tileIndex))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })

  app.post('/games/mines/cashout', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ gameId: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    try {
      return reply.send(await cashoutMines(req.playerId, parsed.data.gameId))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/mines.service.ts apps/api/src/services/mines.service.test.ts apps/api/src/routes/games/mines.ts
git commit -m "feat: mines game service and routes"
```

---

## Task 9: Dice service + routes

**Files:** `apps/api/src/services/dice.service.ts`, `apps/api/src/services/dice.service.test.ts`, `apps/api/src/routes/games/dice.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/services/dice.service.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('../lib/crash-rng.js', () => ({ rollDiceResult: vi.fn() }))
vi.mock('./wallet.service.js', () => ({
  debitForBet: vi.fn(async () => ({ transactionId: 'tx-1', walletId: 'w-1' })),
  creditWinnings: vi.fn(async () => ({ transactionId: 'tx-2', walletId: 'w-1' })),
}))
vi.mock('./crash.service.js', () => ({ getHouseEdge: vi.fn(async () => 1) }))

import { pool } from '@betting/db'
import { rollDiceResult } from '../lib/crash-rng.js'
import { creditWinnings } from './wallet.service.js'
import { rollDice } from './dice.service.js'

const mockConnect = vi.mocked(pool.connect)
const mockRoll = vi.mocked(rollDiceResult)

function makeMockClient(rows: any[][] = []) {
  let i = 0
  return {
    query: vi.fn(async () => { const r = rows[i] ?? []; i++; return { rows: r } }),
    release: vi.fn(),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('rollDice', () => {
  it('wins and calls creditWinnings when result >= target (over)', async () => {
    mockRoll.mockReturnValue(60)
    const client = makeMockClient([
      [{ count: '0' }],  // SELECT nonce
      [{ id: 'bet-1' }], // INSERT bets
      [{}],              // UPDATE locked_balance
      [{}],              // UPDATE bets won
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'over')
    expect(result.won).toBe(true)
    expect(result.result).toBe(60)
    expect(creditWinnings).toHaveBeenCalled()
  })

  it('loses and skips creditWinnings when result < target (over)', async () => {
    mockRoll.mockReturnValue(30)
    const client = makeMockClient([[{ count: '3' }], [{ id: 'bet-1' }], [{}], [{}]])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'over')
    expect(result.won).toBe(false)
    expect(result.winnings).toBe(0)
    expect(creditWinnings).not.toHaveBeenCalled()
  })

  it('wins for under direction when result < target', async () => {
    mockRoll.mockReturnValue(20)
    const client = makeMockClient([[{ count: '0' }], [{ id: 'bet-1' }], [{}], [{}]])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'under')
    expect(result.won).toBe(true)
    expect(creditWinnings).toHaveBeenCalled()
  })

  it('calculates multiplier as (100 - houseEdge) / winCount', async () => {
    mockRoll.mockReturnValue(75)
    const client = makeMockClient([[{ count: '0' }], [{ id: 'bet-1' }], [{}], [{}]])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'over')
    // houseEdge=1, winCount=50, multiplier = 99/50 = 1.98
    expect(result.multiplier).toBeCloseTo(1.98, 1)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter api test -- --reporter=verbose dice.service
```

Expected: FAIL — "Cannot find module './dice.service.js'"

- [ ] **Step 3: Implement dice.service.ts**

Create `apps/api/src/services/dice.service.ts`:
```typescript
import { randomBytes } from 'crypto'
import { pool } from '@betting/db'
import { debitForBet, creditWinnings } from './wallet.service.js'
import { rollDiceResult } from '../lib/crash-rng.js'
import { getHouseEdge } from './crash.service.js'

export async function rollDice(
  playerId: string,
  grossStake: number,
  target: number,
  direction: 'over' | 'under',
): Promise<{
  result: number; won: boolean; multiplier: number; winnings: number
  serverSeed: string; clientSeed: string; nonce: number
}> {
  const serverSeed = randomBytes(32).toString('hex')
  const clientSeed = randomBytes(16).toString('hex')
  const houseEdge = await getHouseEdge('dice_house_edge')

  const winCount = direction === 'over' ? 100 - target : target
  const multiplier = Math.floor(((100 - houseEdge) / winCount) * 100) / 100

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: nonceRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM bets WHERE player_id = $1 AND game_type = 'dice'`,
      [playerId],
    )
    const nonce = Number(nonceRows[0].count)
    const result = rollDiceResult(serverSeed, clientSeed, nonce)
    const won = direction === 'over' ? result >= target : result < target
    const winnings = won ? Math.floor(grossStake * multiplier) : 0

    const { walletId } = await debitForBet(client, playerId, grossStake, grossStake, {
      game: 'dice', result, target, direction,
    })

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO bets (player_id, wallet_id, game_type, gross_stake, wager_tax, effective_stake,
        cashout_multiplier, winnings, status, settled_at)
       VALUES ($1, $2, 'dice', $3, 0, $4, $5, $6, $7, NOW()) RETURNING id`,
      [playerId, walletId, grossStake, grossStake, multiplier, winnings, won ? 'won' : 'lost'],
    )

    if (won) {
      await creditWinnings(client, playerId, winnings, { game: 'dice', betId: rows[0].id })
    }

    await client.query(
      `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
      [grossStake, playerId],
    )

    await client.query('COMMIT')
    return { result, won, multiplier, winnings, serverSeed, clientSeed, nonce }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter api test -- --reporter=verbose dice.service
```

Expected: 4 tests PASS

- [ ] **Step 5: Implement dice routes**

Create `apps/api/src/routes/games/dice.ts`:
```typescript
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { rollDice } from '../../services/dice.service.js'
import { AppError } from '../../lib/errors.js'

const body = z.object({
  grossStake: z.number().int().positive(),
  target: z.number().int().min(1).max(98),
  direction: z.enum(['over', 'under']),
})

export async function diceRoutes(app: FastifyInstance) {
  app.post('/games/dice/roll', { preHandler: authenticate }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    try {
      const { grossStake, target, direction } = parsed.data
      return reply.send(await rollDice(req.playerId, grossStake, target, direction))
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/dice.service.ts apps/api/src/services/dice.service.test.ts apps/api/src/routes/games/dice.ts
git commit -m "feat: dice game service and route"
```

---

## Task 10: Shared game routes + wire server.ts

**Files:** `apps/api/src/routes/games/leaderboard.ts`, `apps/api/src/routes/games/history.ts`, `apps/api/src/server.ts`

- [ ] **Step 1: Create leaderboard route**

Create `apps/api/src/routes/games/leaderboard.ts`:
```typescript
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'

export async function gameLeaderboardRoutes(app: FastifyInstance) {
  app.get('/games/leaderboard', async (_req, reply) => {
    const { rows } = await pool.query(
      `SELECT p.first_name AS player_name, b.game_type AS game,
              b.cashout_multiplier AS multiplier, b.winnings, w.currency, b.settled_at AS won_at
       FROM bets b
       JOIN players p ON p.id = b.player_id
       JOIN wallets w ON w.player_id = b.player_id
       WHERE b.status = 'won' AND b.winnings IS NOT NULL
       ORDER BY b.settled_at DESC LIMIT 10`,
    )
    return reply.send(rows.map(r => ({
      playerName: r.player_name,
      game: r.game,
      multiplier: Number(r.multiplier),
      winnings: Number(r.winnings),
      currency: r.currency,
      wonAt: r.won_at,
    })))
  })
}
```

- [ ] **Step 2: Create history route**

Create `apps/api/src/routes/games/history.ts`:
```typescript
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
}
```

- [ ] **Step 3: Add game routes to server.ts**

Edit `apps/api/src/server.ts` — add these imports after the existing provider imports:
```typescript
import { gameLeaderboardRoutes } from './routes/games/leaderboard.js'
import { gameHistoryRoutes } from './routes/games/history.js'
import { minesRoutes } from './routes/games/mines.js'
import { diceRoutes } from './routes/games/dice.js'
```

And register them in `buildServer()` before the error handler:
```typescript
  app.register(gameLeaderboardRoutes)
  app.register(gameHistoryRoutes)
  app.register(minesRoutes)
  app.register(diceRoutes)
```

- [ ] **Step 4: Run full test suite**

```bash
pnpm --filter api test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/games/ apps/api/src/server.ts
git commit -m "feat: shared game routes (leaderboard, history) wired into server"
```

---

## Task 11: Frontend shared lib

**Files:** `apps/web/tailwind.config.ts`, `apps/web/src/lib/sounds.ts`, `apps/web/src/lib/haptics.ts`

- [ ] **Step 1: Add neon colour tokens to tailwind**

Write `apps/web/tailwind.config.ts`:
```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'game-bg':     '#272422',
        'game-card':   '#1e1b18',
        'game-border': '#3a3530',
        'accent-cyan': '#00F2FE',
        'accent-violet': '#80508B',
        'warning-coral': '#FF4E50',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
```

- [ ] **Step 2: Create sounds.ts**

Create `apps/web/src/lib/sounds.ts`:
```typescript
let ctx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

function playTone(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.3) {
  if (typeof window === 'undefined') return
  try {
    const c = getCtx()
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.connect(g)
    g.connect(c.destination)
    osc.type = type
    osc.frequency.setValueAtTime(freq, c.currentTime)
    g.gain.setValueAtTime(gain, c.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration)
    osc.start(c.currentTime)
    osc.stop(c.currentTime + duration)
  } catch {}
}

export const sounds = {
  win:     () => { playTone(880, 0.15); setTimeout(() => playTone(1100, 0.2), 80) },
  lose:    () => playTone(150, 0.4, 'sawtooth', 0.4),
  tick:    () => playTone(440, 0.05, 'sine', 0.1),
  roll:    () => playTone(600, 0.1, 'triangle'),
  mineHit: () => playTone(80, 0.6, 'sawtooth', 0.5),
  cashout: () => { playTone(660, 0.1); setTimeout(() => playTone(880, 0.1), 60); setTimeout(() => playTone(1100, 0.2), 120) },
}
```

- [ ] **Step 3: Create haptics.ts**

Create `apps/web/src/lib/haptics.ts`:
```typescript
function vibe(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern)
  }
}

export const haptics = {
  win:   () => vibe(200),
  lose:  () => vibe([50, 50, 50]),
  roll:  () => vibe(30),
  tick:  () => vibe(10),
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/tailwind.config.ts apps/web/src/lib/sounds.ts apps/web/src/lib/haptics.ts
git commit -m "feat: game UI colour tokens, sounds, haptics"
```

---

## Task 12: Crash game page

**Files:** `apps/web/src/hooks/useCrashGame.ts`, `apps/web/src/components/game/MultiplierDisplay.tsx`, `apps/web/src/components/game/BetPanel.tsx`, `apps/web/src/components/game/RoundHistory.tsx`, `apps/web/src/components/game/LiveLeaderboard.tsx`, `apps/web/src/app/(player)/games/crash/page.tsx`

- [ ] **Step 1: Create useCrashGame hook**

Create `apps/web/src/hooks/useCrashGame.ts`:
```typescript
'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { getToken } from '@/lib/auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export type RoundStatus = 'idle' | 'waiting' | 'running' | 'crashed'

export interface MyBet {
  betId: string
  effectiveStake: number
  autoCashoutAt?: number
}

export interface CashoutFeed {
  playerId: string
  multiplier: number
  winnings: number
}

export function useCrashGame() {
  const socketRef = useRef<Socket | null>(null)
  const [status, setStatus] = useState<RoundStatus>('idle')
  const [multiplier, setMultiplier] = useState(1.00)
  const [myBet, setMyBet] = useState<MyBet | null>(null)
  const [crashPoint, setCrashPoint] = useState<number | null>(null)
  const [waitingEndsAt, setWaitingEndsAt] = useState<number | null>(null)
  const [recentCrashes, setRecentCrashes] = useState<number[]>([])
  const [feed, setFeed] = useState<CashoutFeed | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const socket = io(API_URL, {
      auth: { token: getToken() },
      transports: ['websocket'],
    })
    socketRef.current = socket

    socket.on('round:waiting', (data: { waitingEndsAt: number }) => {
      setStatus('waiting')
      setWaitingEndsAt(data.waitingEndsAt)
      setMultiplier(1.00)
      setCrashPoint(null)
    })
    socket.on('round:started', () => {
      setStatus('running')
      setMultiplier(1.00)
    })
    socket.on('round:tick', (data: { multiplier: number }) => {
      setMultiplier(data.multiplier)
    })
    socket.on('round:crashed', (data: { crashPoint: number }) => {
      setStatus('crashed')
      setCrashPoint(data.crashPoint)
      setMyBet(null)
      setRecentCrashes(prev => [data.crashPoint, ...prev].slice(0, 20))
    })
    socket.on('bet:confirmed', (data: MyBet) => setMyBet(data))
    socket.on('cashout:confirmed', () => setMyBet(null))
    socket.on('cashout:broadcast', (data: CashoutFeed) => {
      setFeed(data)
      setTimeout(() => setFeed(null), 3000)
    })
    socket.on('bet:error', (data: { message: string }) => setError(data.message))

    return () => { socket.disconnect() }
  }, [])

  const placeBet = useCallback((grossStake: number, autoCashoutAt?: number) => {
    setError(null)
    socketRef.current?.emit('bet:place', { grossStake, autoCashoutAt })
  }, [])

  const cashout = useCallback(() => {
    socketRef.current?.emit('bet:cashout')
  }, [])

  return { status, multiplier, myBet, crashPoint, waitingEndsAt, recentCrashes, feed, error, placeBet, cashout }
}
```

- [ ] **Step 2: Create MultiplierDisplay**

Create `apps/web/src/components/game/MultiplierDisplay.tsx`:
```tsx
'use client'
interface Props {
  multiplier: number
  status: 'idle' | 'waiting' | 'running' | 'crashed'
  crashPoint: number | null
  waitingEndsAt: number | null
}

export function MultiplierDisplay({ multiplier, status, crashPoint, waitingEndsAt }: Props) {
  const isCrashed = status === 'crashed'
  const isWaiting = status === 'waiting'

  return (
    <div className="flex flex-col items-center justify-center h-48 rounded-xl bg-game-card border border-game-border">
      {isWaiting ? (
        <div className="text-center">
          <p className="text-sm text-gray-400 mb-1">Next round starting</p>
          <p className="text-accent-cyan font-mono text-4xl font-bold">WAITING</p>
        </div>
      ) : isCrashed ? (
        <div className="text-center">
          <p className="text-warning-coral font-mono text-5xl font-bold animate-pulse">
            CRASHED
          </p>
          <p className="text-warning-coral font-mono text-2xl mt-1">@ {crashPoint?.toFixed(2)}×</p>
        </div>
      ) : (
        <p
          className="font-mono font-bold text-6xl transition-colors"
          style={{ color: multiplier >= 2 ? '#00F2FE' : '#ffffff' }}
        >
          {multiplier.toFixed(2)}×
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create BetPanel**

Create `apps/web/src/components/game/BetPanel.tsx`:
```tsx
'use client'
import { useState } from 'react'
import type { RoundStatus, MyBet } from '@/hooks/useCrashGame'

interface Props {
  status: RoundStatus
  myBet: MyBet | null
  multiplier: number
  onPlaceBet: (grossStake: number, autoCashoutAt?: number) => void
  onCashout: () => void
}

export function BetPanel({ status, myBet, multiplier, onPlaceBet, onCashout }: Props) {
  const [stake, setStake] = useState('')
  const [autoCashout, setAutoCashout] = useState('')
  const [showAuto, setShowAuto] = useState(false)

  const canBet = status === 'waiting' && !myBet
  const canCashout = status === 'running' && !!myBet

  function handleSubmit() {
    const amount = parseInt(stake)
    if (!amount || amount <= 0) return
    const auto = parseFloat(autoCashout) || undefined
    onPlaceBet(amount, auto)
  }

  return (
    <div className="bg-game-card border border-game-border rounded-xl p-4 space-y-3">
      <div className="flex gap-2">
        <input
          type="number"
          placeholder="Stake (KES)"
          value={stake}
          onChange={e => setStake(e.target.value)}
          disabled={!canBet}
          className="flex-1 bg-game-bg border border-game-border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-accent-cyan disabled:opacity-40"
        />
      </div>

      <div className="flex gap-2">
        {[100, 500, 1000].map(v => (
          <button
            key={v}
            onClick={() => setStake(String(v))}
            disabled={!canBet}
            className="flex-1 bg-game-bg border border-game-border rounded-lg py-1 text-sm text-gray-300 hover:border-accent-cyan disabled:opacity-40"
          >
            +{v}
          </button>
        ))}
      </div>

      <button
        onClick={() => setShowAuto(!showAuto)}
        className="text-xs text-accent-violet underline"
      >
        {showAuto ? 'Hide' : 'Auto cashout'}
      </button>

      {showAuto && (
        <input
          type="number"
          placeholder="Auto cashout at (e.g. 2.00)"
          value={autoCashout}
          onChange={e => setAutoCashout(e.target.value)}
          step="0.01"
          className="w-full bg-game-bg border border-game-border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-accent-cyan"
        />
      )}

      {canCashout ? (
        <button
          onClick={onCashout}
          className="w-full py-3 rounded-xl font-bold text-game-bg bg-accent-cyan text-lg animate-pulse"
        >
          Cash Out @ {multiplier.toFixed(2)}×
        </button>
      ) : myBet ? (
        <button disabled className="w-full py-3 rounded-xl font-bold text-game-bg bg-gray-500 text-lg opacity-60">
          Bet Placed ✓
        </button>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={!canBet}
          className="w-full py-3 rounded-xl font-bold text-game-bg bg-accent-cyan text-lg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Place Bet
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create RoundHistory + LiveLeaderboard**

Create `apps/web/src/components/game/RoundHistory.tsx`:
```tsx
interface Props { crashes: number[] }

export function RoundHistory({ crashes }: Props) {
  return (
    <div className="flex gap-1 overflow-x-auto py-1">
      {crashes.map((c, i) => (
        <span
          key={i}
          className="shrink-0 px-2 py-0.5 rounded-full text-xs font-mono font-bold"
          style={{
            background: c < 2 ? '#FF4E50' : c < 10 ? '#80508B' : '#00F2FE',
            color: '#272422',
          }}
        >
          {c.toFixed(2)}×
        </span>
      ))}
    </div>
  )
}
```

Create `apps/web/src/components/game/LiveLeaderboard.tsx`:
```tsx
import type { CashoutFeed } from '@/hooks/useCrashGame'

export function LiveLeaderboard({ feed }: { feed: CashoutFeed | null }) {
  if (!feed) return null
  return (
    <div className="fixed bottom-20 right-4 bg-game-card border border-accent-cyan rounded-xl px-4 py-2 text-sm animate-bounce-in z-50">
      <span className="text-gray-400">Player cashed out at </span>
      <span className="text-accent-cyan font-mono font-bold">{feed.multiplier.toFixed(2)}×</span>
      <span className="text-gray-400"> — KES </span>
      <span className="text-white font-mono">{feed.winnings}</span>
    </div>
  )
}
```

- [ ] **Step 5: Create crash page**

Create `apps/web/src/app/(player)/games/crash/page.tsx`:
```tsx
'use client'
import { useCrashGame } from '@/hooks/useCrashGame'
import { MultiplierDisplay } from '@/components/game/MultiplierDisplay'
import { BetPanel } from '@/components/game/BetPanel'
import { RoundHistory } from '@/components/game/RoundHistory'
import { LiveLeaderboard } from '@/components/game/LiveLeaderboard'

export default function CrashPage() {
  const { status, multiplier, myBet, crashPoint, waitingEndsAt, recentCrashes, feed, error, placeBet, cashout } = useCrashGame()

  return (
    <div className="min-h-screen bg-game-bg text-white flex flex-col p-4 gap-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-accent-cyan font-mono">CRASH</h1>

      <MultiplierDisplay
        multiplier={multiplier}
        status={status}
        crashPoint={crashPoint}
        waitingEndsAt={waitingEndsAt}
      />

      <BetPanel
        status={status}
        myBet={myBet}
        multiplier={multiplier}
        onPlaceBet={placeBet}
        onCashout={cashout}
      />

      {error && (
        <p className="text-warning-coral text-sm text-center">{error}</p>
      )}

      <RoundHistory crashes={recentCrashes} />

      <LiveLeaderboard feed={feed} />
    </div>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useCrashGame.ts apps/web/src/components/game/MultiplierDisplay.tsx apps/web/src/components/game/BetPanel.tsx apps/web/src/components/game/RoundHistory.tsx apps/web/src/components/game/LiveLeaderboard.tsx apps/web/src/app/\(player\)/games/crash/
git commit -m "feat: crash game page — multiplier display, bet panel, round history"
```

---

## Task 13: Mines game page

**Files:** `apps/web/src/hooks/useMinesGame.ts`, `apps/web/src/components/game/MinesGrid.tsx`, `apps/web/src/app/(player)/games/mines/page.tsx`

- [ ] **Step 1: Create useMinesGame hook**

Create `apps/web/src/hooks/useMinesGame.ts`:
```typescript
'use client'
import { useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { sounds } from '@/lib/sounds'
import { haptics } from '@/lib/haptics'

interface GameState {
  gameId: string
  gridSize: number
  mineCount: number
  serverSeedHash: string
  revealedTiles: number[]
  multiplier: number
  minePositions: number[] | null
  status: 'idle' | 'active' | 'won' | 'lost'
}

export function useMinesGame() {
  const [game, setGame] = useState<GameState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startGame = useCallback(async (grossStake: number, gridSize: number, mineCount: number) => {
    setLoading(true); setError(null)
    const { data, error: err } = await apiFetch<{
      gameId: string; serverSeedHash: string; clientSeed: string; gridSize: number; mineCount: number
    }>('/games/mines/start', { method: 'POST', body: JSON.stringify({ grossStake, gridSize, mineCount }) })
    setLoading(false)
    if (err) { setError(err.message); return }
    setGame({ gameId: data!.gameId, gridSize: data!.gridSize, mineCount: data!.mineCount,
      serverSeedHash: data!.serverSeedHash, revealedTiles: [], multiplier: 1 - 0.05,
      minePositions: null, status: 'active' })
  }, [])

  const revealTile = useCallback(async (tileIndex: number) => {
    if (!game || game.status !== 'active') return
    const { data, error: err } = await apiFetch<{
      safe: boolean; multiplier?: number; minePositions?: number[]
    }>('/games/mines/reveal', { method: 'POST', body: JSON.stringify({ gameId: game.gameId, tileIndex }) })
    if (err) { setError(err.message); return }
    if (data!.safe) {
      sounds.win(); haptics.win()
      setGame(g => g ? { ...g, revealedTiles: [...g.revealedTiles, tileIndex], multiplier: data!.multiplier! } : g)
    } else {
      sounds.mineHit(); haptics.lose()
      setGame(g => g ? { ...g, minePositions: data!.minePositions!, status: 'lost' } : g)
    }
  }, [game])

  const cashout = useCallback(async () => {
    if (!game || game.status !== 'active') return
    const { data, error: err } = await apiFetch<{
      winnings: number; minePositions: number[]; serverSeed: string
    }>('/games/mines/cashout', { method: 'POST', body: JSON.stringify({ gameId: game.gameId }) })
    if (err) { setError(err.message); return }
    sounds.cashout(); haptics.win()
    setGame(g => g ? { ...g, minePositions: data!.minePositions, status: 'won' } : g)
  }, [game])

  return { game, loading, error, startGame, revealTile, cashout }
}
```

- [ ] **Step 2: Create MinesGrid**

Create `apps/web/src/components/game/MinesGrid.tsx`:
```tsx
'use client'
interface Props {
  gridSize: number
  revealedTiles: number[]
  minePositions: number[] | null
  onReveal: (index: number) => void
  disabled: boolean
}

export function MinesGrid({ gridSize, revealedTiles, minePositions, onReveal, disabled }: Props) {
  const total = gridSize * gridSize

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${gridSize}, 1fr)` }}
    >
      {Array.from({ length: total }, (_, i) => {
        const isRevealed = revealedTiles.includes(i)
        const isMine = minePositions?.includes(i)

        return (
          <button
            key={i}
            onClick={() => !disabled && !isRevealed && onReveal(i)}
            disabled={disabled || isRevealed}
            className={`aspect-square rounded-xl border text-2xl font-bold transition-all duration-300 ${
              isMine
                ? 'bg-warning-coral border-warning-coral text-game-bg'
                : isRevealed
                ? 'bg-accent-cyan border-accent-cyan text-game-bg scale-95'
                : 'bg-game-card border-game-border hover:border-accent-cyan active:scale-95'
            }`}
          >
            {isMine ? '💥' : isRevealed ? '💎' : ''}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Create mines page**

Create `apps/web/src/app/(player)/games/mines/page.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useMinesGame } from '@/hooks/useMinesGame'
import { MinesGrid } from '@/components/game/MinesGrid'

export default function MinesPage() {
  const { game, loading, error, startGame, revealTile, cashout } = useMinesGame()
  const [stake, setStake] = useState('')
  const [gridSize, setGridSize] = useState(3)
  const [mineCount, setMineCount] = useState(2)

  const isActive = game?.status === 'active'
  const isOver = game?.status === 'won' || game?.status === 'lost'

  return (
    <div className="min-h-screen bg-game-bg text-white flex flex-col p-4 gap-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-accent-cyan font-mono">MINES</h1>

      {!isActive && (
        <div className="bg-game-card border border-game-border rounded-xl p-4 space-y-3">
          <input
            type="number"
            placeholder="Stake (KES)"
            value={stake}
            onChange={e => setStake(e.target.value)}
            className="w-full bg-game-bg border border-game-border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-accent-cyan"
          />
          <div className="flex gap-2">
            {[3, 4, 5].map(g => (
              <button
                key={g}
                onClick={() => setGridSize(g)}
                className={`flex-1 py-2 rounded-lg font-mono font-bold border ${gridSize === g ? 'border-accent-cyan text-accent-cyan' : 'border-game-border text-gray-400'}`}
              >
                {g}×{g}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">Mines: {mineCount}</span>
            <input
              type="range" min="1" max={gridSize * gridSize - 1}
              value={mineCount} onChange={e => setMineCount(Number(e.target.value))}
              className="flex-1 accent-accent-cyan"
            />
          </div>
          <button
            onClick={() => startGame(parseInt(stake), gridSize, mineCount)}
            disabled={loading || !stake}
            className="w-full py-3 rounded-xl font-bold text-game-bg bg-accent-cyan text-lg disabled:opacity-40"
          >
            {loading ? 'Starting…' : 'Start Game'}
          </button>
        </div>
      )}

      {game && (
        <>
          {isActive && (
            <div className="flex items-center justify-between px-1">
              <span className="text-sm text-gray-400">Multiplier</span>
              <span className="text-accent-cyan font-mono font-bold text-xl">{game.multiplier.toFixed(2)}×</span>
            </div>
          )}

          <MinesGrid
            gridSize={game.gridSize}
            revealedTiles={game.revealedTiles}
            minePositions={game.minePositions}
            onReveal={revealTile}
            disabled={!isActive}
          />

          {isActive && game.revealedTiles.length > 0 && (
            <button
              onClick={cashout}
              className="w-full py-3 rounded-xl font-bold text-game-bg bg-accent-cyan text-lg"
            >
              Cash Out — KES {Math.floor(parseInt(stake || '0') * game.multiplier)}
            </button>
          )}

          {isOver && (
            <div className={`text-center py-3 rounded-xl font-bold text-lg ${game.status === 'won' ? 'text-accent-cyan' : 'text-warning-coral'}`}>
              {game.status === 'won' ? '💎 You won!' : '💥 Mine hit!'}
            </div>
          )}

          {isOver && (
            <button
              onClick={() => window.location.reload()}
              className="w-full py-2 rounded-xl border border-accent-violet text-accent-violet"
            >
              Play Again
            </button>
          )}
        </>
      )}

      {error && <p className="text-warning-coral text-sm text-center">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/useMinesGame.ts apps/web/src/components/game/MinesGrid.tsx apps/web/src/app/\(player\)/games/mines/
git commit -m "feat: mines game page — grid, reveal, cashout"
```

---

## Task 14: Dice game page

**Files:** `apps/web/src/components/game/DiceSlider.tsx`, `apps/web/src/app/(player)/games/dice/page.tsx`

- [ ] **Step 1: Create DiceSlider**

Create `apps/web/src/components/game/DiceSlider.tsx`:
```tsx
'use client'
interface Props {
  target: number
  direction: 'over' | 'under'
  onChange: (target: number) => void
  result: number | null
}

export function DiceSlider({ target, direction, onChange, result }: Props) {
  const winZoneLeft = direction === 'under' ? 0 : target
  const winZoneWidth = direction === 'under' ? target : 100 - target

  return (
    <div className="space-y-2">
      <div className="relative h-8 rounded-full overflow-hidden bg-game-bg border border-game-border">
        <div
          className="absolute inset-y-0 bg-warning-coral opacity-60"
          style={{ left: 0, width: `${direction === 'under' ? 100 - target : target}%` }}
        />
        <div
          className="absolute inset-y-0 bg-accent-cyan opacity-60"
          style={{ left: `${winZoneLeft}%`, width: `${winZoneWidth}%` }}
        />
        {result !== null && (
          <div
            className="absolute inset-y-0 w-1 bg-white"
            style={{ left: `${result}%` }}
          />
        )}
      </div>

      <input
        type="range" min="1" max="98"
        value={target} onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-accent-cyan"
      />
    </div>
  )
}
```

- [ ] **Step 2: Create dice page**

Create `apps/web/src/app/(player)/games/dice/page.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import { sounds } from '@/lib/sounds'
import { haptics } from '@/lib/haptics'
import { DiceSlider } from '@/components/game/DiceSlider'

interface RollResult {
  result: number; won: boolean; multiplier: number; winnings: number
  serverSeed: string; clientSeed: string; nonce: number
}

export default function DicePage() {
  const [stake, setStake] = useState('')
  const [target, setTarget] = useState(50)
  const [direction, setDirection] = useState<'over' | 'under'>('over')
  const [rolling, setRolling] = useState(false)
  const [lastRoll, setLastRoll] = useState<RollResult | null>(null)
  const [history, setHistory] = useState<boolean[]>([])
  const [error, setError] = useState<string | null>(null)

  const houseEdge = 1
  const winCount = direction === 'over' ? 100 - target : target
  const multiplier = Math.floor(((100 - houseEdge) / winCount) * 100) / 100
  const winChance = winCount

  async function handleRoll() {
    const amount = parseInt(stake)
    if (!amount || amount <= 0) return
    setRolling(true); setError(null)
    const { data, error: err } = await apiFetch<RollResult>('/games/dice/roll', {
      method: 'POST',
      body: JSON.stringify({ grossStake: amount, target, direction }),
    })
    setRolling(false)
    if (err) { setError(err.message); return }
    setLastRoll(data!)
    setHistory(prev => [data!.won, ...prev].slice(0, 10))
    if (data!.won) { sounds.win(); haptics.win() }
    else { sounds.lose(); haptics.lose() }
  }

  return (
    <div className="min-h-screen bg-game-bg text-white flex flex-col p-4 gap-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-accent-cyan font-mono">DICE</h1>

      {lastRoll && (
        <div className={`text-center py-4 rounded-xl border ${lastRoll.won ? 'border-accent-cyan' : 'border-warning-coral'}`}>
          <p className="font-mono text-6xl font-bold" style={{ color: lastRoll.won ? '#00F2FE' : '#FF4E50' }}>
            {lastRoll.result}
          </p>
          <p className="text-sm mt-1" style={{ color: lastRoll.won ? '#00F2FE' : '#FF4E50' }}>
            {lastRoll.won ? `+KES ${lastRoll.winnings}` : 'No win'}
          </p>
        </div>
      )}

      <DiceSlider target={target} direction={direction} onChange={setTarget} result={lastRoll?.result ?? null} />

      <div className="flex gap-3 text-sm text-gray-400">
        <span>Win chance: <strong className="text-white">{winChance}%</strong></span>
        <span>Payout: <strong className="text-accent-cyan">{multiplier.toFixed(2)}×</strong></span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setDirection('over')}
          className={`flex-1 py-2 rounded-xl font-bold border ${direction === 'over' ? 'border-accent-cyan text-accent-cyan' : 'border-game-border text-gray-400'}`}
        >
          ROLL OVER
        </button>
        <button
          onClick={() => setDirection('under')}
          className={`flex-1 py-2 rounded-xl font-bold border ${direction === 'under' ? 'border-warning-coral text-warning-coral' : 'border-game-border text-gray-400'}`}
        >
          ROLL UNDER
        </button>
      </div>

      <input
        type="number"
        placeholder="Stake (KES)"
        value={stake}
        onChange={e => setStake(e.target.value)}
        className="w-full bg-game-card border border-game-border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-accent-cyan"
      />

      <button
        onClick={handleRoll}
        disabled={rolling || !stake}
        className="w-full py-3 rounded-xl font-bold text-game-bg bg-accent-cyan text-lg disabled:opacity-40"
      >
        {rolling ? 'Rolling…' : 'Roll'}
      </button>

      <div className="flex gap-1">
        {history.map((won, i) => (
          <div key={i} className="w-3 h-3 rounded-full" style={{ background: won ? '#00F2FE' : '#FF4E50' }} />
        ))}
      </div>

      {error && <p className="text-warning-coral text-sm text-center">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/game/DiceSlider.tsx apps/web/src/app/\(player\)/games/dice/
git commit -m "feat: dice game page — slider, roll, result animation"
```

---

## Task 15: Games lobby

**Files:** `apps/web/src/app/(player)/games/page.tsx`

- [ ] **Step 1: Create lobby page**

Create `apps/web/src/app/(player)/games/page.tsx`:
```tsx
'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface LeaderboardEntry {
  playerName: string; game: string; multiplier: number; winnings: number; currency: string
}

export default function GamesLobby() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])

  useEffect(() => {
    const load = () => apiFetch<LeaderboardEntry[]>('/games/leaderboard')
      .then(({ data }) => data && setLeaderboard(data))
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  const games = [
    {
      href: '/games/crash',
      name: 'CRASH',
      icon: '📈',
      description: 'Cash out before it crashes',
      color: '#00F2FE',
    },
    {
      href: '/games/mines',
      name: 'MINES',
      icon: '💎',
      description: 'Reveal gems, avoid mines',
      color: '#80508B',
    },
    {
      href: '/games/dice',
      name: 'DICE',
      icon: '🎲',
      description: 'Roll over or under your target',
      color: '#00F2FE',
    },
  ]

  return (
    <div className="min-h-screen bg-game-bg text-white p-4 max-w-md mx-auto">
      <h1 className="text-3xl font-bold font-mono mb-6" style={{ color: '#00F2FE' }}>GAMES</h1>

      <div className="flex flex-col gap-3 mb-8">
        {games.map(g => (
          <Link key={g.href} href={g.href}>
            <div className="bg-game-card border border-game-border rounded-xl p-4 flex items-center gap-4 active:scale-98 transition-transform">
              <span className="text-4xl">{g.icon}</span>
              <div className="flex-1">
                <p className="font-mono font-bold text-lg" style={{ color: g.color }}>{g.name}</p>
                <p className="text-sm text-gray-400">{g.description}</p>
              </div>
              <span className="text-accent-violet">›</span>
            </div>
          </Link>
        ))}
      </div>

      {leaderboard.length > 0 && (
        <div>
          <h2 className="text-sm font-mono text-gray-400 mb-2 uppercase tracking-wider">Recent Wins</h2>
          <div className="space-y-2">
            {leaderboard.map((e, i) => (
              <div key={i} className="flex items-center justify-between bg-game-card rounded-lg px-3 py-2 text-sm">
                <span className="text-gray-300">{e.playerName}</span>
                <span className="text-accent-violet font-mono">{e.game.toUpperCase()}</span>
                <span className="text-accent-cyan font-mono font-bold">{e.multiplier.toFixed(2)}×</span>
                <span className="text-white font-mono">{e.currency} {e.winnings}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/\(player\)/games/page.tsx
git commit -m "feat: games lobby page with live leaderboard"
```

---

## Task 16: Deploy to Render

- [ ] **Step 1: Provision Redis on Render**

```bash
curl -s -X POST https://api.render.com/v1/redis \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"wingubid-redis","plan":"free","region":"oregon"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('id:', d['id']); print('url:', d.get('connectionString','check dashboard'))"
```

Note the Redis connection string from the output.

- [ ] **Step 2: Set REDIS_URL on the API service**

```bash
curl -s -X PUT https://api.render.com/v1/services/srv-d7eb279o3t8c73ebvvdg/env-vars \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '[{"key":"REDIS_URL","value":"<redis-connection-string-from-step-1>"}]'
```

- [ ] **Step 3: Add NEXT_PUBLIC_API_URL to web service**

```bash
curl -s -X PUT https://api.render.com/v1/services/srv-d7edvs57vvec73ep0shg/env-vars \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '[{"key":"NEXT_PUBLIC_API_URL","value":"https://wingubid-api.onrender.com"}]'
```

- [ ] **Step 4: Deploy API**

```bash
curl -s -X POST https://api.render.com/v1/services/srv-d7eb279o3t8c73ebvvdg/deploys \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"clearCache":"do_not_clear"}'
```

- [ ] **Step 5: Deploy web**

```bash
curl -s -X POST https://api.render.com/v1/services/srv-d7edvs57vvec73ep0shg/deploys \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"clearCache":"do_not_clear"}'
```

- [ ] **Step 6: Verify**

```bash
curl -s https://wingubid-api.onrender.com/games/leaderboard
```

Expected: `[]` (empty array — no wins yet)

```bash
curl -s -o /dev/null -w "%{http_code}" https://wingubid.onrender.com/games
```

Expected: `200`

- [ ] **Step 7: Final commit (deployment notes)**

```bash
git add -A
git commit -m "chore: Phase 3b complete — Crash, Mines, Dice live on Render"
```
