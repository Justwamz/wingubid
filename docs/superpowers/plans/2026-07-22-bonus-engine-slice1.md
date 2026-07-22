# Bonus Engine (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working bonus wallet + wagering engine: an admin grants a bonus, the player bets it on crash/mines/dice/scratch (never Lotto, never mixed with cash), and net winnings (capped at KES 10,000 per bet) credit to withdrawable cash.

**Architecture:** A dual-wallet model on the existing `wallets` row (`balance` = cash, `bonus_balance` = bonus). A new `bonus_grants` table tracks the single active grant per player. Bets carry a `fund_source`; bonus bets debit `bonus_balance` outright (no lock) and settle net-to-cash. Every in-house game's settlement branches on the bet's `fund_source`. Admin manual grant is the only issuance path in this slice.

**Tech Stack:** Fastify + `@betting/db` (raw SQL, pg pool), Zod, Vitest (API); Next.js 14 + Tailwind (admin + web). Money is integer cents throughout.

## Global Constraints

- Migrations are plain SQL in `packages/db/migrations`, numbered `NNN_name.sql`, run on API boot in filename order; this one is **037**.
- API error shape is always `{ error: { code, message } }`; use `AppError(code, message, statusCode)` from `apps/api/src/lib/errors.js`.
- Money is integer cents. `bonus_max_win_cents` default **1000000** (KES 10,000); `bonus_default_expiry_days` default **30**.
- A wager is entirely cash OR entirely bonus, never mixed. Net bonus winnings = `min(payout - stake, bonus_max_win_cents)`, credited to cash `balance`. Losing bonus bets return nothing. Bonus bets carry `wager_tax = 0`.
- Bonus is allowed on crash, mines, dice, scratch only. Lotto and provider/external games reject bonus (`BONUS_NOT_ALLOWED`, 422).
- At most one active bonus grant per player (partial unique index + friendly pre-check).
- New RBAC permissions `bonuses.view`, `bonuses.grant` added to the code catalog (`apps/api/src/lib/permissions.ts`); super_admin inherits them via wildcard.
- ESM imports keep `.js` extensions even for `.ts` files. No em-dashes in source or UI copy.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Tests: `cd apps/api && npx vitest run <path>`; typecheck `cd apps/api && npx tsc --noEmit`, `cd apps/admin && npx tsc --noEmit`, `cd apps/web && npx tsc --noEmit`.
- Existing cash-bet behavior must remain unchanged (`fund_source` defaults to `'cash'`; `fundSource` params default to `'cash'`).

## File Structure

**API (create):**
- `packages/db/migrations/037_bonus_engine.sql`
- `apps/api/src/routes/admin/bonuses.ts` + `bonuses.test.ts`

**API (modify):**
- `apps/api/src/services/wallet.service.ts` (+ `wallet.service.test.ts`) — bonus helpers.
- `apps/api/src/services/game-settings.service.ts` — `getBonusMaxWinCents`, `getBonusDefaultExpiryDays`.
- `apps/api/src/lib/permissions.ts` — `bonuses` area.
- `apps/api/src/services/dice.service.ts` (+ test), `scratch.service.ts` (+ test), `mines.service.ts` (+ test), `crash.service.ts` (+ test).
- `apps/api/src/routes/games/dice.ts`, `mines.ts`, `scratch.ts`; `apps/api/src/game/crash-socket.ts`.
- `apps/api/src/routes/games/lottery.ts` (or `lottery.service.ts`) — reject bonus.
- `apps/api/src/server.ts` — register bonus routes.

**Admin (create):** `apps/admin/src/components/BonusesTab.tsx`
**Admin (modify):** `apps/admin/src/app/dashboard/page.tsx` — tab wiring.

**Web (create):** `apps/web/src/components/game/BonusToggle.tsx`
**Web (modify):** the four game pages + crash bet hook/panel to pass `fundSource`, plus the wallet/balance display.

---

## Task 1: Migration 037 — bonus schema

**Files:**
- Create: `packages/db/migrations/037_bonus_engine.sql`

**Interfaces:**
- Produces: table `bonus_grants(id, player_id, wallet_id, source, amount_granted, remaining, status, granted_by, expires_at, created_at)`; `bets.fund_source`, `bets.bonus_grant_id`; extended `transactions_type_check`.

- [ ] **Step 1: Write the migration**

Create `packages/db/migrations/037_bonus_engine.sql`:

```sql
-- Replace the unused placeholder grants table (wagering-requirement model we do
-- not use). Safe: no rows in production, no foreign keys reference it yet.
DROP TABLE IF EXISTS bonus_grants;

CREATE TABLE bonus_grants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID   NOT NULL REFERENCES players(id),
  wallet_id      UUID   NOT NULL REFERENCES wallets(id),
  source         VARCHAR(20) NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('manual')),
  amount_granted BIGINT NOT NULL CHECK (amount_granted > 0),
  remaining      BIGINT NOT NULL CHECK (remaining >= 0),
  status         VARCHAR(20) NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','exhausted','expired','revoked')),
  granted_by     UUID   REFERENCES admin_users(id),
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bonus_grants_player_id ON bonus_grants(player_id);
CREATE UNIQUE INDEX uq_bonus_grants_one_active
  ON bonus_grants(player_id) WHERE status = 'active';

ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS fund_source VARCHAR(10) NOT NULL DEFAULT 'cash'
    CHECK (fund_source IN ('cash','bonus')),
  ADD COLUMN IF NOT EXISTS bonus_grant_id UUID REFERENCES bonus_grants(id);

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN (
    'deposit','withdrawal','bet_placed','bet_won','bet_refunded',
    'bonus_credit','bonus_wager','wager_tax','withdrawal_tax','demo_topup',
    'bonus_granted','bonus_bet','bonus_won','bonus_refunded','bonus_forfeited'
  ));
```

- [ ] **Step 2: Typecheck the API (nothing else should break)**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/037_bonus_engine.sql
git commit -m "feat(db): bonus_grants + bets.fund_source + bonus ledger types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Bonus settings getters + wallet bonus helpers

**Files:**
- Modify: `apps/api/src/services/game-settings.service.ts`
- Modify: `apps/api/src/services/wallet.service.ts`
- Test: `apps/api/src/services/wallet.service.test.ts`

**Interfaces:**
- Consumes: `pool`, `PoolClient`, `AppError`.
- Produces:
  - `getBonusMaxWinCents(): Promise<number>` (default 1000000)
  - `getBonusDefaultExpiryDays(): Promise<number>` (default 30)
  - `grantBonus(client, playerId, amount, grantedBy, expiresAt): Promise<{ grantId: string }>`
  - `debitBonusForBet(client, playerId, stake, metadata): Promise<{ walletId: string; grantId: string }>`
  - `settleBonusWin(client, playerId, grantId, payout, stake, betId, maxWinCents): Promise<{ net: number }>`
  - `refundBonusBet(client, playerId, grantId, stake, metadata): Promise<void>`
  - `forfeitBonus(client, grantId, reason): Promise<void>`

- [ ] **Step 1: Add the settings getters**

In `apps/api/src/services/game-settings.service.ts`, add (mirror the existing `getWithdrawalThreshold` read pattern):

```ts
const BONUS_MAX_WIN_KEY = 'bonus_max_win_cents'
const DEFAULT_BONUS_MAX_WIN = 1_000_000 // cents = KES 10,000

export async function getBonusMaxWinCents(): Promise<number> {
  const { rows } = await pool.query<{ value: unknown }>(
    `SELECT value FROM game_settings WHERE key = $1`, [BONUS_MAX_WIN_KEY],
  )
  return rows.length ? Number(rows[0].value) : DEFAULT_BONUS_MAX_WIN
}

const BONUS_EXPIRY_DAYS_KEY = 'bonus_default_expiry_days'
const DEFAULT_BONUS_EXPIRY_DAYS = 30

export async function getBonusDefaultExpiryDays(): Promise<number> {
  const { rows } = await pool.query<{ value: unknown }>(
    `SELECT value FROM game_settings WHERE key = $1`, [BONUS_EXPIRY_DAYS_KEY],
  )
  return rows.length ? Number(rows[0].value) : DEFAULT_BONUS_EXPIRY_DAYS
}
```

- [ ] **Step 2: Write failing tests for the wallet helpers**

Append to `apps/api/src/services/wallet.service.test.ts` (follow the existing file's `vi.mock('@betting/db')` + fake-client style; if the file mocks a client with `query`, reuse it). Add:

```ts
import { settleBonusWin } from './wallet.service.js'

describe('settleBonusWin', () => {
  it('credits net = payout - stake to cash', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = []
    const client = { query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params })
      if (sql.includes('SELECT id, balance')) return { rows: [{ id: 'w1', balance: '0', currency: 'KES' }] }
      if (sql.startsWith('UPDATE wallets')) return { rows: [{ balance: '15000' }] }
      return { rows: [{ id: 'tx1' }] }
    }) } as never
    const { net } = await settleBonusWin(client, 'p1', 'g1', 25000, 10000, 'b1', 1_000_000)
    expect(net).toBe(15000) // 25000 payout - 10000 stake
  })

  it('caps net at maxWinCents', async () => {
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, balance')) return { rows: [{ id: 'w1', balance: '0', currency: 'KES' }] }
      if (sql.startsWith('UPDATE wallets')) return { rows: [{ balance: '1000000' }] }
      return { rows: [{ id: 'tx1' }] }
    }) } as never
    const { net } = await settleBonusWin(client, 'p1', 'g1', 5_000_000, 100_000, 'b1', 1_000_000)
    expect(net).toBe(1_000_000) // capped
  })

  it('credits nothing when payout <= stake', async () => {
    const updates: string[] = []
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, balance')) return { rows: [{ id: 'w1', balance: '0', currency: 'KES' }] }
      if (sql.startsWith('UPDATE wallets')) { updates.push(sql); return { rows: [{ balance: '0' }] } }
      return { rows: [{ id: 'tx1' }] }
    }) } as never
    const { net } = await settleBonusWin(client, 'p1', 'g1', 5000, 10000, 'b1', 1_000_000)
    expect(net).toBe(0)
    expect(updates.length).toBe(0) // no cash credit performed
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run src/services/wallet.service.test.ts`
Expected: FAIL (`settleBonusWin` not exported).

- [ ] **Step 4: Implement the helpers**

Append to `apps/api/src/services/wallet.service.ts`:

```ts
// ---- Bonus wallet -----------------------------------------------------------

// Credit a fresh manual bonus into the player's bonus wallet and open a grant.
// The partial unique index on bonus_grants(player_id) WHERE status='active'
// guarantees at most one active grant; a second concurrent grant violates it.
export async function grantBonus(
  client: PoolClient,
  playerId: string,
  amount: number,
  grantedBy: string,
  expiresAt: Date,
): Promise<{ grantId: string }> {
  const wallet = await selectWalletForUpdate(client, playerId)
  const { rows: grantRows } = await client.query<{ id: string }>(
    `INSERT INTO bonus_grants (player_id, wallet_id, source, amount_granted, remaining, status, granted_by, expires_at)
     VALUES ($1, $2, 'manual', $3, $3, 'active', $4, $5) RETURNING id`,
    [playerId, wallet.id, amount, grantedBy, expiresAt],
  )
  const { rows: updated } = await client.query<{ bonus_balance: string }>(
    `UPDATE wallets SET bonus_balance = bonus_balance + $1 WHERE player_id = $2 RETURNING bonus_balance`,
    [amount, playerId],
  )
  await client.query(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, 'bonus_granted', $3, $4, 'completed', $5::jsonb)`,
    [wallet.id, playerId, amount, Number(updated[0].bonus_balance), JSON.stringify({ grantId: grantRows[0].id, grantedBy })],
  )
  return { grantId: grantRows[0].id }
}

// Debit a bonus-funded stake from the active grant. No locked_balance: the stake
// leaves the bonus wallet outright (never returned on a normal loss). Throws if
// there is no usable active grant or it is expired / underfunded.
export async function debitBonusForBet(
  client: PoolClient,
  playerId: string,
  stake: number,
  metadata: Record<string, unknown>,
): Promise<{ walletId: string; grantId: string }> {
  if (!Number.isInteger(stake) || stake <= 0) {
    throw new AppError('INVALID_STAKE', "That bet amount isn't valid.", 400)
  }
  const wallet = await selectWalletForUpdate(client, playerId)
  const { rows: grants } = await client.query<{ id: string; remaining: string; expires_at: string | null }>(
    `SELECT id, remaining, expires_at FROM bonus_grants
     WHERE player_id = $1 AND status = 'active' FOR UPDATE`,
    [playerId],
  )
  if (grants.length === 0) throw new AppError('NO_ACTIVE_BONUS', "You don't have an active bonus.", 422)
  const grant = grants[0]
  if (grant.expires_at && new Date(grant.expires_at).getTime() <= Date.now()) {
    await forfeitBonus(client, grant.id, 'expired')
    throw new AppError('NO_ACTIVE_BONUS', 'Your bonus has expired.', 422)
  }
  if (Number(grant.remaining) < stake) {
    throw new AppError('INSUFFICIENT_BONUS', "You don't have enough bonus for this.", 422)
  }

  const { rows: updated } = await client.query<{ bonus_balance: string }>(
    `UPDATE wallets SET bonus_balance = bonus_balance - $1 WHERE player_id = $2 RETURNING bonus_balance`,
    [stake, playerId],
  )
  const newRemaining = Number(grant.remaining) - stake
  await client.query(
    `UPDATE bonus_grants SET remaining = $1, status = CASE WHEN $1 = 0 THEN 'exhausted' ELSE status END WHERE id = $2`,
    [newRemaining, grant.id],
  )
  await client.query(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, 'bonus_bet', $3, $4, 'completed', $5::jsonb)`,
    [wallet.id, playerId, stake, Number(updated[0].bonus_balance), JSON.stringify({ ...metadata, grantId: grant.id })],
  )
  return { walletId: wallet.id, grantId: grant.id }
}

// Settle a winning bonus bet: credit net = min(payout - stake, cap) to CASH.
export async function settleBonusWin(
  client: PoolClient,
  playerId: string,
  grantId: string,
  payout: number,
  stake: number,
  betId: string,
  maxWinCents: number,
): Promise<{ net: number }> {
  const net = Math.min(Math.max(payout - stake, 0), maxWinCents)
  if (net <= 0) return { net: 0 }
  const wallet = await selectWalletForUpdate(client, playerId)
  const { rows: updated } = await client.query<{ balance: string }>(
    `UPDATE wallets SET balance = balance + $1 WHERE player_id = $2 RETURNING balance`,
    [net, playerId],
  )
  await client.query(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, 'bonus_won', $3, $4, 'completed', $5::jsonb)`,
    [wallet.id, playerId, net, Number(updated[0].balance), JSON.stringify({ grantId, betId, payout, stake })],
  )
  return { net }
}

// Return a bonus stake to the bonus wallet (voided in-flight round).
export async function refundBonusBet(
  client: PoolClient,
  playerId: string,
  grantId: string,
  stake: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  const wallet = await selectWalletForUpdate(client, playerId)
  const { rows: updated } = await client.query<{ bonus_balance: string }>(
    `UPDATE wallets SET bonus_balance = bonus_balance + $1 WHERE player_id = $2 RETURNING bonus_balance`,
    [stake, playerId],
  )
  await client.query(
    `UPDATE bonus_grants SET remaining = remaining + $1,
       status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END
     WHERE id = $2`,
    [stake, grantId],
  )
  await client.query(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, 'bonus_refunded', $3, $4, 'completed', $5::jsonb)`,
    [wallet.id, playerId, stake, Number(updated[0].bonus_balance), JSON.stringify({ ...metadata, grantId })],
  )
}

// Zero out and close a grant (expiry / revoke). Writes a forfeited ledger row.
export async function forfeitBonus(
  client: PoolClient,
  grantId: string,
  reason: 'expired' | 'revoked',
): Promise<void> {
  const { rows } = await client.query<{ player_id: string; wallet_id: string; remaining: string }>(
    `SELECT player_id, wallet_id, remaining FROM bonus_grants WHERE id = $1 FOR UPDATE`,
    [grantId],
  )
  if (rows.length === 0) return
  const g = rows[0]
  const remaining = Number(g.remaining)
  const { rows: updated } = await client.query<{ bonus_balance: string }>(
    `UPDATE wallets SET bonus_balance = GREATEST(bonus_balance - $1, 0) WHERE id = $2 RETURNING bonus_balance`,
    [remaining, g.wallet_id],
  )
  await client.query(
    `UPDATE bonus_grants SET remaining = 0, status = $2 WHERE id = $1`,
    [grantId, reason],
  )
  if (remaining > 0) {
    await client.query(
      `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
       VALUES ($1, $2, 'bonus_forfeited', $3, $4, 'completed', $5::jsonb)`,
      [g.wallet_id, g.player_id, remaining, Number(updated[0].bonus_balance), JSON.stringify({ grantId, reason })],
    )
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run src/services/wallet.service.test.ts`
Expected: PASS. Then `cd apps/api && npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/wallet.service.ts apps/api/src/services/wallet.service.test.ts apps/api/src/services/game-settings.service.ts
git commit -m "feat(api): bonus wallet helpers + bonus settings getters

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Permission catalog + admin bonus routes

**Files:**
- Modify: `apps/api/src/lib/permissions.ts`
- Create: `apps/api/src/routes/admin/bonuses.ts`
- Test: `apps/api/src/routes/admin/bonuses.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `authenticateAdmin`, `requirePermission`, `pool`, `AppError`, `grantBonus`, `getBonusDefaultExpiryDays`.
- Produces routes `POST /admin/bonuses/grant`, `GET /admin/bonuses`; permission keys `bonuses.view`, `bonuses.grant`; `adminBonusRoutes` registered in server.

- [ ] **Step 1: Add the `bonuses` permission area**

In `apps/api/src/lib/permissions.ts`, add to `PERMISSION_CATALOG` (before the `staff` group is fine):

```ts
  { area: 'bonuses', label: 'Bonuses', permissions: [
    { key: 'bonuses.view', label: 'View bonuses' },
    { key: 'bonuses.grant', label: 'Grant bonuses' },
  ] },
```

- [ ] **Step 2: Write failing route tests**

Create `apps/api/src/routes/admin/bonuses.test.ts` (mirror `staff.test.ts`):

```ts
import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: vi.fn(async (req: { adminId: string }) => { req.adminId = 'admin-1' }),
}))
vi.mock('../../services/permissions.service.js', () => ({
  getPermissionsForAdmin: vi.fn(async () => ({ has: () => true })),
  invalidatePermissionsCache: vi.fn(),
}))
vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('../../services/game-settings.service.js', () => ({
  getBonusDefaultExpiryDays: vi.fn(async () => 30),
}))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)
const mockConnect = vi.mocked(pool.connect)

function fakeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[] }) {
  return { query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)), release: vi.fn() }
}

describe('POST /admin/bonuses/grant', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('grants a bonus to a player with no active grant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] } as never)          // player exists
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)                       // no active grant
    mockConnect.mockResolvedValueOnce(fakeClient((sql) => {
      if (sql.includes('SELECT id, balance')) return { rows: [{ id: 'w1', balance: '0', currency: 'KES' }] }
      if (sql.includes('INSERT INTO bonus_grants')) return { rows: [{ id: 'g1' }] }
      if (sql.startsWith('UPDATE wallets')) return { rows: [{ bonus_balance: '50000' }] }
      return { rows: [] }
    }) as never)
    const res = await app.inject({ method: 'POST', url: '/admin/bonuses/grant', headers: { Authorization: 'Bearer t' },
      payload: { playerId: 'p1', amountCents: 50000 } })
    expect(res.statusCode).toBe(200)
    expect(res.json().grantId).toBe('g1')
  })

  it('rejects when the player already has an active grant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] } as never)  // player exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'g0' }] } as never)  // active grant exists
    const res = await app.inject({ method: 'POST', url: '/admin/bonuses/grant', headers: { Authorization: 'Bearer t' },
      payload: { playerId: 'p1', amountCents: 50000 } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('ACTIVE_BONUS_EXISTS')
  })

  it('rejects a non-positive amount', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/bonuses/grant', headers: { Authorization: 'Bearer t' },
      payload: { playerId: 'p1', amountCents: 0 } })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 3: Run to verify fail**

Run: `cd apps/api && npx vitest run src/routes/admin/bonuses.test.ts`
Expected: FAIL (route 404 / module not found).

- [ ] **Step 4: Implement the routes**

Create `apps/api/src/routes/admin/bonuses.ts`:

```ts
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { grantBonus } from '../../services/wallet.service.js'
import { getBonusDefaultExpiryDays } from '../../services/game-settings.service.js'

async function audit(adminId: string, action: string, entityId: string | null, after: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO admin_audit_log (admin_id, action, entity, entity_id, after) VALUES ($1, $2, 'bonus', $3, $4::jsonb)`,
    [adminId, action, entityId, JSON.stringify(after ?? {})],
  )
}

export async function adminBonusRoutes(app: FastifyInstance) {
  app.get('/admin/bonuses', { preHandler: [authenticateAdmin, requirePermission('bonuses.view')] }, async (_req, reply) => {
    const { rows } = await pool.query(
      `SELECT bg.id, bg.amount_granted, bg.remaining, bg.status, bg.expires_at, bg.created_at,
              p.name AS player_name, p.phone AS player_phone
       FROM bonus_grants bg JOIN players p ON p.id = bg.player_id
       ORDER BY bg.created_at DESC LIMIT 100`,
    )
    return reply.send({ bonuses: rows })
  })

  app.post('/admin/bonuses/grant', { preHandler: [authenticateAdmin, requirePermission('bonuses.grant')] }, async (req, reply) => {
    const parsed = z.object({
      playerId: z.string().uuid(),
      amountCents: z.number().int().positive('Amount must be greater than zero.'),
      expiresInDays: z.number().int().min(1).max(365).optional(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    const { rows: playerRows } = await pool.query<{ id: string }>(`SELECT id FROM players WHERE id = $1`, [parsed.data.playerId])
    if (playerRows.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Player not found.' } })

    const { rows: active } = await pool.query<{ id: string }>(
      `SELECT id FROM bonus_grants WHERE player_id = $1 AND status = 'active'`, [parsed.data.playerId],
    )
    if (active.length > 0) {
      return reply.status(409).send({ error: { code: 'ACTIVE_BONUS_EXISTS', message: 'This player already has an active bonus.' } })
    }

    const days = parsed.data.expiresInDays ?? await getBonusDefaultExpiryDays()
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { grantId } = await grantBonus(client, parsed.data.playerId, parsed.data.amountCents, req.adminId, expiresAt)
      await client.query('COMMIT')
      await audit(req.adminId, 'bonus_grant', grantId, { playerId: parsed.data.playerId, amountCents: parsed.data.amountCents, expiresAt })
      return reply.send({ grantId, remaining: parsed.data.amountCents })
    } catch (err) {
      await client.query('ROLLBACK')
      if ((err as { code?: string }).code === '23505') {
        return reply.status(409).send({ error: { code: 'ACTIVE_BONUS_EXISTS', message: 'This player already has an active bonus.' } })
      }
      throw err
    } finally {
      client.release()
    }
  })
}
```

- [ ] **Step 5: Register in `server.ts`**

Add near the other admin route imports: `import { adminBonusRoutes } from './routes/admin/bonuses.js'`
Add with the other registrations: `app.register(adminBonusRoutes)`

- [ ] **Step 6: Run tests + typecheck**

Run: `cd apps/api && npx vitest run src/routes/admin/bonuses.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/permissions.ts apps/api/src/routes/admin/bonuses.ts apps/api/src/routes/admin/bonuses.test.ts apps/api/src/server.ts
git commit -m "feat(api): admin bonus grant + list routes with bonuses.* permissions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Dice + Scratch bonus support (instant games)

**Files:**
- Modify: `apps/api/src/services/dice.service.ts`, `apps/api/src/routes/games/dice.ts`, `apps/api/src/services/dice.service.test.ts`
- Modify: `apps/api/src/services/scratch.service.ts`, `apps/api/src/routes/games/scratch.ts`, `apps/api/src/services/scratch.service.test.ts`

**Interfaces:**
- Consumes: `debitBonusForBet`, `settleBonusWin`, `getBonusMaxWinCents`.
- Produces: `rollDice(playerId, grossStake, target, direction, fundSource='cash')`; `buyScratchCard(playerId, stakeCents, fundSource='cash')`.

- [ ] **Step 1: Write a failing dice bonus test**

In `apps/api/src/services/dice.service.test.ts`, add a case following the file's existing mock pattern (it mocks `@betting/db` pool.connect client, `getHouseEdge`, `nextDiceRoll`, and `assertGameEnabled`). Add mocks for the bonus helpers and assert a bonus win credits net (not full winnings) and marks the bet `fund_source='bonus'`:

```ts
// at top with other vi.mock calls:
vi.mock('./wallet.service.js', async (orig) => ({
  ...(await orig<typeof import('./wallet.service.js')>()),
  debitBonusForBet: vi.fn(async () => ({ walletId: 'w1', grantId: 'g1' })),
  settleBonusWin: vi.fn(async () => ({ net: 15000 })),
}))
vi.mock('./game-settings.service.js', () => ({
  assertGameEnabled: vi.fn(async () => {}),
  getBonusMaxWinCents: vi.fn(async () => 1_000_000),
}))

// test:
it('bonus win settles net to cash and records fund_source=bonus', async () => {
  // ...arrange the existing client mock so the roll is a win and the INSERT INTO bets returns an id...
  const { debitBonusForBet, settleBonusWin } = await import('./wallet.service.js')
  const res = await rollDice('p1', 10000, 50, 'over', 'bonus')
  expect(debitBonusForBet).toHaveBeenCalled()
  if (res.won) expect(settleBonusWin).toHaveBeenCalled()
})
```

> The implementer should adapt the arrangement to the existing test's mock shape; the key assertions are that `debitBonusForBet` (not `debitForBet`) runs for `fundSource='bonus'` and `settleBonusWin` runs on a win.

- [ ] **Step 2: Run to verify fail**

Run: `cd apps/api && npx vitest run src/services/dice.service.test.ts`
Expected: FAIL (rollDice has no fundSource param).

- [ ] **Step 3: Implement dice bonus branch**

In `apps/api/src/services/dice.service.ts`, add imports and the `fundSource` param:

```ts
import { debitForBet, creditWinnings, debitBonusForBet, settleBonusWin } from './wallet.service.js'
import { assertGameEnabled, getBonusMaxWinCents } from './game-settings.service.js'
```

Change the signature to `rollDice(playerId, grossStake, target, direction, fundSource: 'cash' | 'bonus' = 'cash')`. Inside the transaction, replace the debit + INSERT + credit block with:

```ts
    let walletId: string
    let bonusGrantId: string | null = null
    if (fundSource === 'bonus') {
      const r = await debitBonusForBet(client, playerId, grossStake, { game: 'dice', result, target, direction })
      walletId = r.walletId; bonusGrantId = r.grantId
    } else {
      const r = await debitForBet(client, playerId, grossStake, grossStake, { game: 'dice', result, target, direction }, { lock: false })
      walletId = r.walletId
    }

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO bets (player_id, wallet_id, game_type, gross_stake, wager_tax, effective_stake,
        cashout_multiplier, winnings, status, settled_at, fund_source, bonus_grant_id)
       VALUES ($1, $2, 'dice', $3, 0, $4, $5, $6, $7, NOW(), $8, $9) RETURNING id`,
      [playerId, walletId, grossStake, grossStake, multiplier, winnings, won ? 'won' : 'lost', fundSource, bonusGrantId],
    )

    if (won) {
      if (fundSource === 'bonus') {
        await settleBonusWin(client, playerId, bonusGrantId!, winnings, grossStake, rows[0].id, await getBonusMaxWinCents())
      } else {
        await creditWinnings(client, playerId, winnings, { game: 'dice', betId: rows[0].id })
      }
    }
```

- [ ] **Step 4: Thread `fundSource` through the dice route**

In `apps/api/src/routes/games/dice.ts`, add to the body schema `fundSource: z.enum(['cash','bonus']).default('cash')`, and pass it: `return reply.send(await rollDice(req.playerId, grossStake, target, direction, fundSource))`.

- [ ] **Step 5: Apply the same pattern to scratch**

In `apps/api/src/services/scratch.service.ts`: add the imports (`debitBonusForBet`, `settleBonusWin`, `getBonusMaxWinCents`), add `fundSource: 'cash' | 'bonus' = 'cash'` to `buyScratchCard`, branch the debit (bonus path, no lock is already the case), add `fund_source`/`bonus_grant_id` to the `INSERT INTO bets`/scratch settlement, and on a prize use `settleBonusWin(client, playerId, grantId, prizeCents, stakeCents, cardId, await getBonusMaxWinCents())` instead of `creditWinnings` when `fundSource === 'bonus'`. In `apps/api/src/routes/games/scratch.ts`, add `fundSource` to the buy body schema and pass it. Add a scratch test asserting the bonus win path calls `settleBonusWin`.

- [ ] **Step 6: Run tests + typecheck**

Run: `cd apps/api && npx vitest run src/services/dice.service.test.ts src/services/scratch.service.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/dice.service.ts apps/api/src/routes/games/dice.ts apps/api/src/services/dice.service.test.ts apps/api/src/services/scratch.service.ts apps/api/src/routes/games/scratch.ts apps/api/src/services/scratch.service.test.ts
git commit -m "feat(api): bonus-funded bets for dice + scratch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Mines bonus support

**Files:**
- Modify: `apps/api/src/services/mines.service.ts`, `apps/api/src/routes/games/mines.ts`, `apps/api/src/services/mines.service.test.ts`

**Interfaces:**
- Consumes: `debitBonusForBet`, `settleBonusWin`, `getBonusMaxWinCents`.
- Produces: `startGame(playerId, grossStake, gridSize, mineCount, fundSource='cash')`.

- [ ] **Step 1: Write a failing test**

In `apps/api/src/services/mines.service.test.ts`, add a bonus case following the existing mock pattern (mocks `@betting/db`, `getRedis`, `wallet.service`, `game-settings.service`). Assert: `startGame(..., 'bonus')` calls `debitBonusForBet`; the bet INSERT includes `fund_source` and `bonus_grant_id`; a bonus cashout calls `settleBonusWin` and does NOT run the `locked_balance` decrement.

- [ ] **Step 2: Run to verify fail**

Run: `cd apps/api && npx vitest run src/services/mines.service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `apps/api/src/services/mines.service.ts`:
- Imports: `import { debitForBet, creditWinnings, debitBonusForBet, settleBonusWin, refundBonusBet } from './wallet.service.js'` and `import { assertGameEnabled, getBonusMaxWinCents } from './game-settings.service.js'`.
- Add `fundSource: 'cash' | 'bonus' = 'cash'` to `startGame`. Branch the debit like dice (bonus → `debitBonusForBet`, capturing `grantId`). Add `fund_source, bonus_grant_id` to the `INSERT INTO bets`. Keep `effectiveStake` in the redis state as today.
- In `cashoutMines`: change the bet SELECT to `SELECT effective_stake, fund_source, bonus_grant_id FROM bets ...`. After computing `winnings`, branch:

```ts
    if (rows[0].fund_source === 'bonus') {
      await settleBonusWin(client, playerId, rows[0].bonus_grant_id, winnings, effectiveStake, state.betId, await getBonusMaxWinCents())
      // bonus stake was not locked, so do NOT touch locked_balance
    } else {
      await creditWinnings(client, playerId, winnings, { game: 'mines', gameId, multiplier: paidMultiplier })
      await client.query(`UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`, [effectiveStake, playerId])
    }
```

- In `revealTile` (mine-hit loss): change the bet SELECT to also read `fund_source`; only run the `locked_balance` decrement when `fund_source = 'cash'` (bonus bets never locked). Still set the bet `status = 'lost'` in both cases.

- [ ] **Step 4: Route**

In `apps/api/src/routes/games/mines.ts`, add `fundSource: z.enum(['cash','bonus']).default('cash')` to the start body and pass it to `startGame`.

- [ ] **Step 5: Run + typecheck**

Run: `cd apps/api && npx vitest run src/services/mines.service.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/mines.service.ts apps/api/src/routes/games/mines.ts apps/api/src/services/mines.service.test.ts
git commit -m "feat(api): bonus-funded bets for mines (settle branches on fund_source)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Crash bonus support

**Files:**
- Modify: `apps/api/src/services/crash.service.ts`, `apps/api/src/game/crash-socket.ts`, `apps/api/src/services/crash.service.test.ts`

**Interfaces:**
- Consumes: `debitBonusForBet`, `settleBonusWin`, `getBonusMaxWinCents`.
- Produces: `placeBet(playerId, roundId, grossStake, autoCashoutAt, fundSource='cash')`.

- [ ] **Step 1: Write a failing test**

In `apps/api/src/services/crash.service.test.ts`, add a bonus case: `placeBet(..., 'bonus')` calls `debitBonusForBet` and records `fund_source='bonus'`; a bonus `cashout` calls `settleBonusWin` and does NOT decrement `locked_balance`; `settleLostBets` on a bonus bet does not decrement `locked_balance`.

- [ ] **Step 2: Run to verify fail**

Run: `cd apps/api && npx vitest run src/services/crash.service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `apps/api/src/services/crash.service.ts`:
- Imports: `import { debitForBet, creditWinnings, debitBonusForBet, settleBonusWin } from './wallet.service.js'` and `import { assertGameEnabled, getBonusMaxWinCents } from './game-settings.service.js'` (assertGameEnabled import already present via game-settings; add getBonusMaxWinCents).
- `placeBet` gains `fundSource: 'cash' | 'bonus' = 'cash'`. Branch the debit (bonus → `debitBonusForBet`, capture `grantId`), and add `fund_source, bonus_grant_id` to the `INSERT INTO bets` (values `$7,$8`), returning them is not needed.
- `cashout`: change the bet SELECT to `SELECT id, effective_stake, fund_source, bonus_grant_id FROM bets ...`. Branch:

```ts
    if (rows[0].fund_source === 'bonus') {
      await settleBonusWin(client, playerId, rows[0].bonus_grant_id, winnings, effectiveStake, betId, await getBonusMaxWinCents())
      // no locked_balance decrement for bonus
    } else {
      await creditWinnings(client, playerId, winnings, { game: 'crash', betId, multiplier })
      await client.query(`UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`, [effectiveStake, playerId])
    }
```

- `settleLostBets`: change the active-bets SELECT to also read `fund_source`; only decrement `locked_balance` for `fund_source = 'cash'` bets (bonus bets never locked). Still mark all `lost`.

- [ ] **Step 4: Socket**

In `apps/api/src/game/crash-socket.ts`, add `fundSource: z.enum(['cash','bonus']).default('cash')` to the `bet:place` payload schema and pass it: `await placeBet(playerId, round.roundId, grossStake, autoCashoutAt, fundSource)`.

- [ ] **Step 5: Run + typecheck**

Run: `cd apps/api && npx vitest run src/services/crash.service.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/crash.service.ts apps/api/src/game/crash-socket.ts apps/api/src/services/crash.service.test.ts
git commit -m "feat(api): bonus-funded bets for crash (cashout + settle branch on fund_source)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Lottery rejects bonus

**Files:**
- Modify: `apps/api/src/routes/games/lottery.ts` (and/or `apps/api/src/services/lottery.service.ts`)
- Test: `apps/api/src/services/lottery.service.test.ts` or a route test

**Interfaces:**
- Produces: lottery ticket purchase rejects `fundSource='bonus'` with `BONUS_NOT_ALLOWED` (422).

- [ ] **Step 1: Write a failing test**

Add a test asserting that a lottery purchase request with `fundSource: 'bonus'` returns 422 `BONUS_NOT_ALLOWED`. (Read `apps/api/src/routes/games/lottery.ts` to match its request shape.)

- [ ] **Step 2: Run to verify fail**

Run: `cd apps/api && npx vitest run src/services/lottery.service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In the lottery purchase route, accept an optional `fundSource` in the body and, before any purchase logic, reject bonus:

```ts
    if ((req.body as { fundSource?: string })?.fundSource === 'bonus') {
      return reply.status(422).send({ error: { code: 'BONUS_NOT_ALLOWED', message: 'Bonus funds cannot be used on Wingu Lotto.' } })
    }
```

- [ ] **Step 4: Run + typecheck**

Run: `cd apps/api && npx vitest run && npx tsc --noEmit`
Expected: full suite PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/games/lottery.ts apps/api/src/services/lottery.service.test.ts
git commit -m "feat(api): reject bonus funds on Wingu Lotto

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Admin Bonuses tab

**Files:**
- Create: `apps/admin/src/components/BonusesTab.tsx`
- Modify: `apps/admin/src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `apiFetch`; routes `GET /admin/bonuses`, `POST /admin/bonuses/grant`.

- [ ] **Step 1: Write the BonusesTab component**

Create `apps/admin/src/components/BonusesTab.tsx`:

```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface BonusRow {
  id: string; amount_granted: number; remaining: number; status: string
  expires_at: string | null; created_at: string; player_name: string; player_phone: string
}

function kes(cents: number) { return `KES ${(cents / 100).toLocaleString('en-KE')}` }

export function BonusesTab() {
  const [rows, setRows] = useState<BonusRow[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ playerId: '', amount: '', expiresInDays: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await apiFetch<{ bonuses: BonusRow[] }>('/admin/bonuses')
    if (data) setRows(data.bonuses)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function grant(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const body: Record<string, unknown> = { playerId: form.playerId.trim(), amountCents: Math.round(parseFloat(form.amount) * 100) }
    if (form.expiresInDays) body.expiresInDays = parseInt(form.expiresInDays)
    const { error } = await apiFetch('/admin/bonuses/grant', { method: 'POST', body: JSON.stringify(body) })
    setBusy(false)
    setMsg(error ? error.message : 'Bonus granted.')
    if (!error) { setForm({ playerId: '', amount: '', expiresInDays: '' }); await load() }
  }

  return (
    <div className="space-y-6">
      {msg && <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-cyan-300">{msg}</div>}

      <form onSubmit={grant} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3 max-w-md">
        <h3 className="font-semibold text-sm">Grant a bonus</h3>
        <input required placeholder="Player ID (UUID)" value={form.playerId} onChange={e => setForm({ ...form, playerId: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <input required type="number" step="0.01" placeholder="Amount (KES)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <input type="number" placeholder="Expires in days (default 30)" value={form.expiresInDays} onChange={e => setForm({ ...form, expiresInDays: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <button type="submit" disabled={busy} className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm py-2 rounded-lg">
          {busy ? 'Granting...' : 'Grant bonus'}
        </button>
      </form>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
            <th className="text-left px-4 py-3">Player</th><th className="text-left px-4 py-3">Phone</th>
            <th className="text-right px-4 py-3">Granted</th><th className="text-right px-4 py-3">Remaining</th>
            <th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">Expires</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">Loading...</td></tr>
            : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">No bonuses yet</td></tr>
            : rows.map(b => (
              <tr key={b.id} className="border-b border-gray-800/50">
                <td className="px-4 py-3">{b.player_name}</td>
                <td className="px-4 py-3 text-gray-400">{b.player_phone}</td>
                <td className="px-4 py-3 text-right font-mono">{kes(b.amount_granted)}</td>
                <td className="px-4 py-3 text-right font-mono">{kes(b.remaining)}</td>
                <td className="px-4 py-3">{b.status}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{b.expires_at ? new Date(b.expires_at).toLocaleDateString() : 'never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire into the dashboard**

In `apps/admin/src/app/dashboard/page.tsx`:
- Import: `import { BonusesTab } from '@/components/BonusesTab'`
- Add `'bonuses'` to the `tab` state union, to `ALL_TABS`, and to `TAB_PERMISSION` as `bonuses: 'bonuses.view'`.
- Render after the staff panel: `{tab === 'bonuses' && <BonusesTab />}`

- [ ] **Step 3: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/components/BonusesTab.tsx apps/admin/src/app/dashboard/page.tsx
git commit -m "feat(admin): Bonuses tab (grant + list)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Player bonus balance + bet-with-bonus toggle

**Files:**
- Create: `apps/web/src/components/game/BonusToggle.tsx`
- Modify: the four game pages under `apps/web/src/app/(player)/games/` and the crash bet path; the wallet/balance display.

**Interfaces:**
- Consumes: the player wallet balance endpoint (already returns `bonusBalance`).
- Produces: a `fundSource` sent on every in-house game bet.

- [ ] **Step 1: Write the shared toggle**

Create `apps/web/src/components/game/BonusToggle.tsx`:

```tsx
'use client'

interface Props {
  bonusBalance: number  // cents
  value: 'cash' | 'bonus'
  onChange: (v: 'cash' | 'bonus') => void
  disabled?: boolean
}

// Shown only when the player holds a bonus. Bonus and cash cannot be mixed in a
// single bet, so this is a hard switch of the funding source.
export function BonusToggle({ bonusBalance, value, onChange, disabled }: Props) {
  if (bonusBalance <= 0) return null
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-500">Pay with:</span>
      <div className="inline-flex rounded-lg overflow-hidden border border-game-border">
        {(['cash', 'bonus'] as const).map(v => (
          <button key={v} type="button" disabled={disabled} onClick={() => onChange(v)}
            className={`px-3 py-1 transition-colors ${value === v ? 'bg-accent-cyan text-game-bg font-semibold' : 'bg-game-bg text-gray-400'}`}>
            {v === 'cash' ? 'Cash' : `Bonus (KES ${(bonusBalance / 100).toLocaleString('en-KE')})`}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Surface the bonus balance**

Find where the player cash balance is displayed (the wallet/header component) and show `bonusBalance` beside it when `> 0` (the balance API already returns `bonusBalance`; read it the same way the cash balance is read). Label it "Bonus".

- [ ] **Step 3: Wire the toggle into dice, mines, scratch pages**

For each of `apps/web/src/app/(player)/games/wingu-dice/page.tsx`, `wingu-mines/page.tsx`, `wingu-scratch/page.tsx`:
- Add `const [fundSource, setFundSource] = useState<'cash' | 'bonus'>('cash')`.
- Fetch the player's `bonusBalance` (reuse the existing balance fetch) and render `<BonusToggle bonusBalance={bonusBalance} value={fundSource} onChange={setFundSource} />` above the stake input.
- Include `fundSource` in the bet request body: dice `POST /games/dice` body gains `fundSource`; mines `POST /games/mines` (start) body gains `fundSource`; scratch `POST /games/scratch` buy body gains `fundSource`.
- When `fundSource === 'bonus'`, cap the entered/quick stake at `bonusBalance`.

- [ ] **Step 4: Wire the toggle into crash**

In the crash page + `BetPanel` + the crash socket hook:
- `BetPanel` `onPlaceBet` signature becomes `(grossStake: number, autoCashoutAt?: number, fundSource?: 'cash' | 'bonus') => void`; render `<BonusToggle .../>` and pass the chosen `fundSource` from `handleSubmit`.
- The crash hook's `bet:place` socket emit includes `fundSource`.

- [ ] **Step 5: Typecheck + compile**

Run: `cd apps/web && npx tsc --noEmit`
Then compile-smoke the four game routes with `npx next dev` on a spare port and curl each (200), or rely on tsc if dev is impractical headlessly.
Expected: no type errors; pages compile.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/game/BonusToggle.tsx apps/web/src/app/(player)/games apps/web/src/components
git commit -m "feat(web): bonus balance display + bet-with-bonus toggle across games

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Full verification + deploy

**Files:** none (verification/deploy).

- [ ] **Step 1: Full API suite + typecheck**

Run: `cd apps/api && npx vitest run && npx tsc --noEmit`
Expected: all pass (existing cash-bet tests still green because `fund_source`/`fundSource` default to cash).

- [ ] **Step 2: Admin + web typecheck**

Run: `cd apps/admin && npx tsc --noEmit` and `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Push + deploy API, then Admin, then Web (Render)**

```bash
git push origin <branch>
```

Deploy via `RENDER_API_KEY` from `.env`: API (`srv-d7eb279o3t8c73ebvvdg`) first so migration 037 runs, then Admin (`srv-d7ee004vikkc73enkl40`), then Web (`srv-d7edvs57vvec73ep0shg`). Poll each deploy to `live`.

- [ ] **Step 4: Prod smoke**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://wingubid-api.onrender.com/admin/bonuses   # expect 401
```

Confirm the API deploy log shows `applied 037_bonus_engine.sql`.

- [ ] **Step 5: Manual walkthrough (owner, login-gated)**

As an admin: open the **Bonuses** tab, grant a small bonus to a test player. As that player: confirm the bonus balance shows, toggle "Bonus", place a winning bet on dice/crash/mines/scratch, and confirm net winnings (capped at 10k) land in cash while the free stake is not returned; confirm the "Bonus" toggle is absent on Lotto and a bonus bet there is rejected.

---

## Self-Review Notes

- **Spec coverage:** separate wallets + net-to-cash + per-bet cap (Tasks 2, 4-6); per-bet cap value + expiry defaults (Task 2 settings); lotto block (Task 7); one-active-bonus (Task 1 unique index + Task 3 pre-check); admin manual grant + permissions + tab (Tasks 3, 8); player toggle + balance (Task 9); crash/mines settlement branching on `fund_source` (Tasks 5-6); migration replacing the placeholder table (Task 1). All spec sections map to a task.
- **Type consistency:** `debitBonusForBet`/`settleBonusWin`/`refundBonusBet`/`grantBonus`/`forfeitBonus` signatures match across Tasks 2, 4, 5, 6; `fundSource: 'cash' | 'bonus'` consistent across services, routes, socket, and UI; `bonus_max_win_cents`/`bonus_default_expiry_days` getter names consistent (Tasks 2, 3, 4, 5, 6).
- **Known follow-ups (out of scope, later slices):** self-service claims, campaigns, target lists (Slice 3); IP/device/household/network abuse checks (Slice 2); admin editing of cap/expiry; provider-game bonus support.
