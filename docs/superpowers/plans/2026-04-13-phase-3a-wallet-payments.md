# Phase 3a: Wallet & Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the player wallet system: balance operations, M-Pesa/MTN/Airtel stub adapters, tax engine, payment flow, seamless wallet API for third-party providers, and daily tax reconciliation cron.

**Architecture:** All logic in `apps/api`. One new migration (`payment_transactions`). Tax/wallet/payment split into focused service files. Stub providers log calls and return mock refs — real API calls wired later. Provider wallet API authenticated via HMAC-SHA256. Daily cron runs in-process via `node-cron`.

**Tech Stack:** Node.js 20, TypeScript 5, Fastify 4, PostgreSQL (pg), `node-cron`, Vitest, pnpm monorepo.

**Existing schema (do not re-create):**
- `wallets` — balance, bonus_balance, locked_balance (migration 003)
- `transactions` — append-only ledger, types: deposit/withdrawal/bet_placed/bet_won/bet_refunded/bonus_credit/bonus_wager/wager_tax/withdrawal_tax (migration 004)
- `tax_rules` — rate NUMERIC(5,2), enabled (migration 005, table name is `tax_rules` not `tax_config`)
- `tax_transactions`, `ledger_closes`, `tax_remittances` — migration 005
- `country_settings` — min/max deposit/withdrawal limits (migration 008, table name is `country_settings` not `wallet_limits`)
- `admin_users` — foreign key target for updated_by fields

---

## File Map

```
packages/db/migrations/
└── 010_payment_transactions.sql      # NEW — provider payment lifecycle tracking

apps/api/src/
├── lib/
│   ├── errors.ts                     # NEW — AppError (moved from auth.service.ts)
│   └── cron.ts                       # NEW — daily tax reconciliation
├── services/
│   ├── tax.service.ts                # NEW — calculateTax, recordTax
│   ├── wallet.service.ts             # NEW — getWalletBalance, debitForBet, creditDeposit, lockForWithdrawal, settleWithdrawal, creditWinnings, refundBet
│   ├── payment.service.ts            # NEW — initiateDeposit, confirmDeposit, initiateWithdrawal, confirmWithdrawal
│   ├── auth.service.ts               # MODIFY — import AppError from lib/errors.ts
│   └── providers/
│       ├── provider.interface.ts     # NEW — PaymentProvider interface
│       ├── mpesa.provider.ts         # NEW — stub
│       ├── mtn.provider.ts           # NEW — stub
│       ├── airtel.provider.ts        # NEW — stub
│       └── index.ts                  # NEW — getProvider(country, choice)
├── middleware/
│   └── authenticate-provider.ts     # NEW — HMAC auth for /provider/* routes
└── routes/
    ├── wallet/
    │   ├── balance.ts                # NEW — GET /wallet/balance
    │   ├── deposit.ts                # NEW — POST /wallet/deposit
    │   └── withdraw.ts               # NEW — POST /wallet/withdraw
    ├── webhooks/
    │   ├── mpesa.ts                  # NEW — POST /webhooks/mpesa
    │   ├── mtn.ts                    # NEW — POST /webhooks/mtn
    │   ├── airtel.ts                 # NEW — POST /webhooks/airtel
    │   └── stub.ts                   # NEW — POST /webhooks/stub/complete (non-prod only)
    └── provider/
        ├── balance.ts                # NEW — GET /provider/balance
        ├── debit.ts                  # NEW — POST /provider/debit
        ├── credit.ts                 # NEW — POST /provider/credit
        └── rollback.ts               # NEW — POST /provider/rollback
```

---

## Task 1: payment_transactions migration

**Files:**
- Create: `packages/db/migrations/010_payment_transactions.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- packages/db/migrations/010_payment_transactions.sql
CREATE TABLE payment_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        UUID NOT NULL REFERENCES players(id),
  wallet_id        UUID NOT NULL REFERENCES wallets(id),
  type             VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
  provider         VARCHAR(20) NOT NULL CHECK (provider IN ('mpesa', 'mtn', 'airtel')),
  amount           BIGINT NOT NULL CHECK (amount > 0),
  currency         CHAR(3) NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'awaiting_callback', 'completed', 'failed')),
  idempotency_key  VARCHAR(255) UNIQUE NOT NULL,
  provider_ref     VARCHAR(255),
  failure_reason   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_transactions_player_id ON payment_transactions(player_id);
CREATE INDEX idx_payment_transactions_provider_ref ON payment_transactions(provider_ref)
  WHERE provider_ref IS NOT NULL;
```

- [ ] **Step 2: Verify migration applies locally (optional — runs automatically on API start)**

If you have a local Postgres running via Docker Compose:
```bash
cd .worktrees/phase-3a
DATABASE_SSL=false DATABASE_URL=postgresql://betting:betting@localhost:5432/betting \
  pnpm --filter @betting/db migrate
```
Expected: `apply 010_payment_transactions.sql`

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/010_payment_transactions.sql
git commit -m "feat(db): add payment_transactions migration"
```

---

## Task 2: Add node-cron dependency

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Install node-cron**

```bash
cd .worktrees/phase-3a
pnpm --filter api add node-cron
pnpm --filter api add -D @types/node-cron
```

- [ ] **Step 2: Verify package.json updated**

```bash
grep node-cron apps/api/package.json
```
Expected: `"node-cron": "^3.x.x"` in dependencies

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add node-cron dependency"
```

---

## Task 3: Extract AppError to lib/errors.ts

**Files:**
- Create: `apps/api/src/lib/errors.ts`
- Modify: `apps/api/src/services/auth.service.ts`

- [ ] **Step 1: Create `apps/api/src/lib/errors.ts`**

```typescript
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message)
    this.name = 'AppError'
  }
}
```

- [ ] **Step 2: Update `apps/api/src/services/auth.service.ts`**

Remove the `AppError` class definition from the top of the file and add the import:

```typescript
import { AppError } from '../lib/errors.js'
```

The `export class AppError` block (lines 8–16 of the current file) must be deleted. The rest of the file is unchanged.

- [ ] **Step 3: Build to verify no type errors**

```bash
cd .worktrees/phase-3a
pnpm --filter api build
```
Expected: no errors

- [ ] **Step 4: Run existing tests to confirm nothing broke**

```bash
pnpm --filter api test
```
Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/errors.ts apps/api/src/services/auth.service.ts
git commit -m "refactor(api): extract AppError to lib/errors.ts"
```

---

## Task 4: Tax service

**Files:**
- Create: `apps/api/src/services/tax.service.test.ts`
- Create: `apps/api/src/services/tax.service.ts`

**Context:** `tax_rules` has columns `country CHAR(2)`, `tax_type VARCHAR(20)`, `rate NUMERIC(5,2)` (e.g. `12.50` for 12.5%), `enabled BOOLEAN`. Tax amount = `Math.floor(grossAmount * rate / 100)`.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/services/tax.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@betting/db'
import { calculateTax, recordTax } from './tax.service.js'

const mockQuery = vi.mocked(pool.query)
beforeEach(() => mockQuery.mockReset())

describe('calculateTax', () => {
  it('returns correct tax and effective amount when enabled', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ rate: '12.50', enabled: true }],
    } as any)

    const result = await calculateTax('KE', 'wager_tax', 10000)

    expect(result.taxAmount).toBe(1250)
    expect(result.effectiveAmount).toBe(8750)
    expect(result.ratePct).toBe(12.5)
  })

  it('returns zero tax when rule is disabled', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ rate: '0.00', enabled: false }],
    } as any)

    const result = await calculateTax('UG', 'wager_tax', 10000)

    expect(result.taxAmount).toBe(0)
    expect(result.effectiveAmount).toBe(10000)
  })

  it('returns zero tax when no rule exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const result = await calculateTax('XX', 'wager_tax', 10000)

    expect(result.taxAmount).toBe(0)
    expect(result.effectiveAmount).toBe(10000)
  })

  it('floors fractional tax amounts', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ rate: '12.50', enabled: true }],
    } as any)

    // 100 * 12.5 / 100 = 12.5 → floor = 12
    const result = await calculateTax('KE', 'wager_tax', 100)
    expect(result.taxAmount).toBe(12)
    expect(result.effectiveAmount).toBe(88)
  })
})

describe('recordTax', () => {
  it('inserts a tax_transactions row', async () => {
    const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) }

    await recordTax(mockClient as any, {
      playerId: 'player-1',
      taxAmount: 1250,
      taxType: 'wager_tax',
      country: 'KE',
      transactionId: 'tx-1',
    })

    expect(mockClient.query).toHaveBeenCalledOnce()
    const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT INTO tax_transactions')
    expect(params).toContain('player-1')
    expect(params).toContain(1250)
    expect(params).toContain('wager_tax')
    expect(params).toContain('tx-1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd .worktrees/phase-3a
pnpm --filter api test tax.service
```
Expected: FAIL — `calculateTax` not found

- [ ] **Step 3: Implement `apps/api/src/services/tax.service.ts`**

```typescript
import type { PoolClient } from 'pg'
import { pool } from '@betting/db'

export interface TaxResult {
  taxAmount: number
  effectiveAmount: number
  ratePct: number
}

export async function calculateTax(
  country: string,
  taxType: 'wager_tax' | 'withdrawal_tax',
  grossAmount: number,
): Promise<TaxResult> {
  const { rows } = await pool.query<{ rate: string; enabled: boolean }>(
    `SELECT rate, enabled FROM tax_rules WHERE country = $1 AND tax_type = $2`,
    [country, taxType],
  )

  if (rows.length === 0 || !rows[0].enabled) {
    return { taxAmount: 0, effectiveAmount: grossAmount, ratePct: 0 }
  }

  const ratePct = parseFloat(rows[0].rate)
  const taxAmount = Math.floor((grossAmount * ratePct) / 100)
  return { taxAmount, effectiveAmount: grossAmount - taxAmount, ratePct }
}

export async function recordTax(
  client: PoolClient,
  params: {
    playerId: string
    taxAmount: number
    taxType: 'wager_tax' | 'withdrawal_tax'
    country: string
    transactionId: string
  },
): Promise<void> {
  await client.query(
    `INSERT INTO tax_transactions (player_id, transaction_id, tax_type, country, amount)
     VALUES ($1, $2, $3, $4, $5)`,
    [params.playerId, params.transactionId, params.taxType, params.country, params.taxAmount],
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter api test tax.service
```
Expected: all 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/tax.service.ts apps/api/src/services/tax.service.test.ts
git commit -m "feat(api): add tax service with calculateTax and recordTax"
```

---

## Task 5: Wallet service

**Files:**
- Create: `apps/api/src/services/wallet.service.test.ts`
- Create: `apps/api/src/services/wallet.service.ts`

**Context:** Wallet has `balance`, `locked_balance`, `bonus_balance`. `transactions` table is the append-only ledger. All mutations use `FOR UPDATE` pessimistic lock. The caller passes in a `PoolClient` that's already in a transaction.

Functions:
- `getWalletBalance(playerId)` — read-only, no lock
- `debitForBet(client, playerId, grossStake, effectiveStake, meta)` — balance -= gross, locked += effective, insert tx(type='bet_placed')
- `creditDeposit(client, playerId, amount, idempotencyKey, meta)` — balance += amount, insert tx(type='deposit')
- `lockForWithdrawal(client, playerId, amount)` — balance -= amount, locked += amount, NO tx ledger entry
- `settleWithdrawal(client, playerId, amount, netPayout, success, meta)` — if success: locked -= amount, insert tx(type='withdrawal', status='completed', amount=netPayout); if fail: locked -= amount, balance += amount, insert tx(type='withdrawal', status='failed')
- `creditWinnings(client, playerId, amount, meta)` — balance += amount, insert tx(type='bet_won')
- `refundBet(client, playerId, amount, meta)` — locked -= amount, balance += amount, insert tx(type='bet_refunded')

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/services/wallet.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@betting/db'
import {
  getWalletBalance,
  debitForBet,
  creditDeposit,
  lockForWithdrawal,
  settleWithdrawal,
  creditWinnings,
  refundBet,
} from './wallet.service.js'

const mockQuery = vi.mocked(pool.query)

function makeMockClient(rows: any[][] = []) {
  let callIndex = 0
  return {
    query: vi.fn(async () => {
      const r = rows[callIndex] ?? []
      callIndex++
      return { rows: r, rowCount: r.length }
    }),
  }
}

beforeEach(() => mockQuery.mockReset())

describe('getWalletBalance', () => {
  it('returns wallet fields for player', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        wallet_id: 'w-1',
        balance: '10000',
        bonus_balance: '0',
        locked_balance: '0',
        currency: 'KES',
      }],
    } as any)

    const result = await getWalletBalance('player-1')

    expect(result).toEqual({
      walletId: 'w-1',
      balance: 10000,
      bonusBalance: 0,
      lockedBalance: 0,
      currency: 'KES',
    })
  })

  it('throws NOT_FOUND if wallet missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    await expect(getWalletBalance('bad-player')).rejects.toMatchObject({
      code: 'WALLET_NOT_FOUND',
    })
  })
})

describe('debitForBet', () => {
  it('debits gross from balance, adds effective to locked, inserts bet_placed tx', async () => {
    const client = makeMockClient([
      // SELECT wallet FOR UPDATE
      [{ id: 'w-1', balance: '20000', currency: 'KES' }],
      // UPDATE wallets
      [{ balance: '10000', locked_balance: '8750' }],
      // INSERT transactions
      [{ id: 'tx-1' }],
    ])

    const result = await debitForBet(client as any, 'player-1', 10000, 8750, { roundId: 'r-1' })

    expect(result.transactionId).toBe('tx-1')
    const updateCall = client.query.mock.calls[1] as [string, unknown[]]
    expect(updateCall[0]).toContain('balance = balance - $1')
    expect(updateCall[0]).toContain('locked_balance = locked_balance + $2')
    expect(updateCall[1]).toContain(10000) // gross
    expect(updateCall[1]).toContain(8750)  // effective
  })

  it('throws INSUFFICIENT_FUNDS when balance too low', async () => {
    const client = makeMockClient([
      [{ id: 'w-1', balance: '500', currency: 'KES' }],
    ])

    await expect(
      debitForBet(client as any, 'player-1', 10000, 8750, {})
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' })
  })
})

describe('creditDeposit', () => {
  it('credits balance and inserts deposit tx', async () => {
    const client = makeMockClient([
      [{ id: 'w-1', balance: '0', currency: 'KES' }],
      [{ balance: '10000' }],
      [{ id: 'tx-2' }],
    ])

    const result = await creditDeposit(client as any, 'player-1', 10000, 'idem-key', {})
    expect(result.transactionId).toBe('tx-2')

    const insertCall = client.query.mock.calls[2] as [string, unknown[]]
    expect(insertCall[0]).toContain('INSERT INTO transactions')
    expect(insertCall[1]).toContain('deposit')
    expect(insertCall[1]).toContain('idem-key')
  })
})

describe('lockForWithdrawal', () => {
  it('moves amount from balance to locked, no tx inserted', async () => {
    const client = makeMockClient([
      [{ id: 'w-1', balance: '20000', currency: 'KES' }],
      [{ balance: '10000', locked_balance: '10000' }],
    ])

    await lockForWithdrawal(client as any, 'player-1', 10000)
    expect(client.query).toHaveBeenCalledTimes(2) // SELECT + UPDATE, no INSERT
  })

  it('throws INSUFFICIENT_FUNDS when balance too low', async () => {
    const client = makeMockClient([[{ id: 'w-1', balance: '500', currency: 'KES' }]])
    await expect(lockForWithdrawal(client as any, 'player-1', 10000))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' })
  })
})

describe('settleWithdrawal', () => {
  it('decrements locked and inserts completed withdrawal tx on success', async () => {
    const client = makeMockClient([
      [{ id: 'w-1', balance: '0', currency: 'KES' }],
      [{}],       // UPDATE wallets
      [{ id: 'tx-3' }], // INSERT tx
    ])

    await settleWithdrawal(client as any, 'player-1', 10000, 8000, true, {})

    const updateCall = client.query.mock.calls[1] as [string, unknown[]]
    expect(updateCall[0]).toContain('locked_balance = locked_balance - $1')
    const insertCall = client.query.mock.calls[2] as [string, unknown[]]
    expect(insertCall[1]).toContain('withdrawal')
    expect(insertCall[1]).toContain('completed')
    expect(insertCall[1]).toContain(8000) // net payout
  })

  it('returns funds to balance and inserts failed tx on failure', async () => {
    const client = makeMockClient([
      [{ id: 'w-1', balance: '0', currency: 'KES' }],
      [{}],
      [{ id: 'tx-4' }],
    ])

    await settleWithdrawal(client as any, 'player-1', 10000, 8000, false, {})

    const updateCall = client.query.mock.calls[1] as [string, unknown[]]
    expect(updateCall[0]).toContain('balance = balance + $2')
    const insertCall = client.query.mock.calls[2] as [string, unknown[]]
    expect(insertCall[1]).toContain('failed')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter api test wallet.service
```
Expected: FAIL — `getWalletBalance` not found

- [ ] **Step 3: Implement `apps/api/src/services/wallet.service.ts`**

```typescript
import type { PoolClient } from 'pg'
import { pool } from '@betting/db'
import { AppError } from '../lib/errors.js'

export interface WalletBalance {
  walletId: string
  balance: number
  bonusBalance: number
  lockedBalance: number
  currency: string
}

type WalletRow = { id: string; balance: string; currency: string }

async function selectWalletForUpdate(
  client: PoolClient,
  playerId: string,
): Promise<WalletRow> {
  const { rows } = await client.query<WalletRow>(
    `SELECT id, balance, currency FROM wallets WHERE player_id = $1 FOR UPDATE`,
    [playerId],
  )
  if (rows.length === 0) throw new AppError('WALLET_NOT_FOUND', 'Wallet not found', 404)
  return rows[0]
}

export async function getWalletBalance(playerId: string): Promise<WalletBalance> {
  const { rows } = await pool.query<{
    wallet_id: string; balance: string; bonus_balance: string
    locked_balance: string; currency: string
  }>(
    `SELECT id AS wallet_id, balance, bonus_balance, locked_balance, currency
     FROM wallets WHERE player_id = $1`,
    [playerId],
  )
  if (rows.length === 0) throw new AppError('WALLET_NOT_FOUND', 'Wallet not found', 404)
  const w = rows[0]
  return {
    walletId: w.wallet_id,
    balance: Number(w.balance),
    bonusBalance: Number(w.bonus_balance),
    lockedBalance: Number(w.locked_balance),
    currency: w.currency,
  }
}

export async function debitForBet(
  client: PoolClient,
  playerId: string,
  grossStake: number,
  effectiveStake: number,
  metadata: Record<string, unknown>,
): Promise<{ transactionId: string; walletId: string }> {
  const wallet = await selectWalletForUpdate(client, playerId)
  if (Number(wallet.balance) < grossStake) {
    throw new AppError('INSUFFICIENT_FUNDS', 'Insufficient balance', 422)
  }

  const { rows: updated } = await client.query<{ balance: string }>(
    `UPDATE wallets
     SET balance = balance - $1, locked_balance = locked_balance + $2
     WHERE player_id = $3
     RETURNING balance`,
    [grossStake, effectiveStake, playerId],
  )

  const { rows: txRows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, 'bet_placed', $3, $4, 'completed', $5)
     RETURNING id`,
    [wallet.id, playerId, effectiveStake, Number(updated[0].balance), JSON.stringify(metadata)],
  )

  return { transactionId: txRows[0].id, walletId: wallet.id }
}

export async function creditDeposit(
  client: PoolClient,
  playerId: string,
  amount: number,
  idempotencyKey: string,
  metadata: Record<string, unknown>,
): Promise<{ transactionId: string; walletId: string }> {
  const wallet = await selectWalletForUpdate(client, playerId)

  const { rows: updated } = await client.query<{ balance: string }>(
    `UPDATE wallets SET balance = balance + $1 WHERE player_id = $2 RETURNING balance`,
    [amount, playerId],
  )

  const { rows: txRows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, idempotency_key, metadata)
     VALUES ($1, $2, 'deposit', $3, $4, 'completed', $5, $6)
     RETURNING id`,
    [wallet.id, playerId, amount, Number(updated[0].balance), idempotencyKey, JSON.stringify(metadata)],
  )

  return { transactionId: txRows[0].id, walletId: wallet.id }
}

export async function lockForWithdrawal(
  client: PoolClient,
  playerId: string,
  amount: number,
): Promise<{ walletId: string }> {
  const wallet = await selectWalletForUpdate(client, playerId)
  if (Number(wallet.balance) < amount) {
    throw new AppError('INSUFFICIENT_FUNDS', 'Insufficient balance', 422)
  }

  await client.query(
    `UPDATE wallets SET balance = balance - $1, locked_balance = locked_balance + $1 WHERE player_id = $2`,
    [amount, playerId],
  )

  return { walletId: wallet.id }
}

export async function settleWithdrawal(
  client: PoolClient,
  playerId: string,
  amount: number,
  netPayout: number,
  success: boolean,
  metadata: Record<string, unknown>,
): Promise<void> {
  const wallet = await selectWalletForUpdate(client, playerId)

  if (success) {
    const { rows: updated } = await client.query<{ balance: string }>(
      `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2 RETURNING balance`,
      [amount, playerId],
    )
    await client.query(
      `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
       VALUES ($1, $2, 'withdrawal', $3, $4, 'completed', $5)`,
      [wallet.id, playerId, netPayout, Number(updated[0].balance), JSON.stringify(metadata)],
    )
  } else {
    const { rows: updated } = await client.query<{ balance: string }>(
      `UPDATE wallets
       SET locked_balance = locked_balance - $1, balance = balance + $2
       WHERE player_id = $3
       RETURNING balance`,
      [amount, amount, playerId],
    )
    await client.query(
      `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
       VALUES ($1, $2, 'withdrawal', $3, $4, 'failed', $5)`,
      [wallet.id, playerId, netPayout, Number(updated[0].balance), JSON.stringify(metadata)],
    )
  }
}

export async function creditWinnings(
  client: PoolClient,
  playerId: string,
  amount: number,
  metadata: Record<string, unknown>,
): Promise<{ transactionId: string; walletId: string }> {
  const wallet = await selectWalletForUpdate(client, playerId)

  const { rows: updated } = await client.query<{ balance: string }>(
    `UPDATE wallets SET balance = balance + $1 WHERE player_id = $2 RETURNING balance`,
    [amount, playerId],
  )

  const { rows: txRows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, 'bet_won', $3, $4, 'completed', $5)
     RETURNING id`,
    [wallet.id, playerId, amount, Number(updated[0].balance), JSON.stringify(metadata)],
  )

  return { transactionId: txRows[0].id, walletId: wallet.id }
}

export async function refundBet(
  client: PoolClient,
  playerId: string,
  amount: number,
  metadata: Record<string, unknown>,
): Promise<{ transactionId: string; walletId: string }> {
  const wallet = await selectWalletForUpdate(client, playerId)

  const { rows: updated } = await client.query<{ balance: string }>(
    `UPDATE wallets
     SET locked_balance = locked_balance - $1, balance = balance + $1
     WHERE player_id = $2
     RETURNING balance`,
    [amount, playerId],
  )

  const { rows: txRows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, 'bet_refunded', $3, $4, 'completed', $5)
     RETURNING id`,
    [wallet.id, playerId, amount, Number(updated[0].balance), JSON.stringify(metadata)],
  )

  return { transactionId: txRows[0].id, walletId: wallet.id }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter api test wallet.service
```
Expected: all tests passing

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/wallet.service.ts apps/api/src/services/wallet.service.test.ts
git commit -m "feat(api): add wallet service with balance operations"
```

---

## Task 6: Payment provider interface + stub adapters

**Files:**
- Create: `apps/api/src/services/providers/provider.interface.ts`
- Create: `apps/api/src/services/providers/mpesa.provider.ts`
- Create: `apps/api/src/services/providers/mtn.provider.ts`
- Create: `apps/api/src/services/providers/airtel.provider.ts`
- Create: `apps/api/src/services/providers/index.ts`

- [ ] **Step 1: Create `apps/api/src/services/providers/provider.interface.ts`**

```typescript
export interface DepositParams {
  playerId: string
  phone: string
  amount: number
  currency: string
  reference: string
}

export interface WithdrawParams {
  playerId: string
  phone: string
  amount: number
  currency: string
  reference: string
}

export interface PaymentProvider {
  readonly name: string
  deposit(params: DepositParams): Promise<{ providerRef: string }>
  withdraw(params: WithdrawParams): Promise<{ providerRef: string }>
}
```

- [ ] **Step 2: Create `apps/api/src/services/providers/mpesa.provider.ts`**

```typescript
import crypto from 'crypto'
import type { PaymentProvider, DepositParams, WithdrawParams } from './provider.interface.js'

export const mpesaProvider: PaymentProvider = {
  name: 'mpesa',

  async deposit(params: DepositParams) {
    const providerRef = `stub-mpesa-${crypto.randomUUID().slice(0, 8)}`
    console.log(
      `[PAYMENT STUB] M-Pesa STK Push: ${params.currency} ${params.amount / 100} to ${params.phone} (ref: ${providerRef})`,
    )
    return { providerRef }
  },

  async withdraw(params: WithdrawParams) {
    const providerRef = `stub-mpesa-${crypto.randomUUID().slice(0, 8)}`
    console.log(
      `[PAYMENT STUB] M-Pesa B2C: ${params.currency} ${params.amount / 100} to ${params.phone} (ref: ${providerRef})`,
    )
    return { providerRef }
  },
}
```

- [ ] **Step 3: Create `apps/api/src/services/providers/mtn.provider.ts`**

```typescript
import crypto from 'crypto'
import type { PaymentProvider, DepositParams, WithdrawParams } from './provider.interface.js'

export const mtnProvider: PaymentProvider = {
  name: 'mtn',

  async deposit(params: DepositParams) {
    const providerRef = `stub-mtn-${crypto.randomUUID().slice(0, 8)}`
    console.log(
      `[PAYMENT STUB] MTN MoMo Collection: ${params.currency} ${params.amount / 100} to ${params.phone} (ref: ${providerRef})`,
    )
    return { providerRef }
  },

  async withdraw(params: WithdrawParams) {
    const providerRef = `stub-mtn-${crypto.randomUUID().slice(0, 8)}`
    console.log(
      `[PAYMENT STUB] MTN MoMo Disbursement: ${params.currency} ${params.amount / 100} to ${params.phone} (ref: ${providerRef})`,
    )
    return { providerRef }
  },
}
```

- [ ] **Step 4: Create `apps/api/src/services/providers/airtel.provider.ts`**

```typescript
import crypto from 'crypto'
import type { PaymentProvider, DepositParams, WithdrawParams } from './provider.interface.js'

export const airtelProvider: PaymentProvider = {
  name: 'airtel',

  async deposit(params: DepositParams) {
    const providerRef = `stub-airtel-${crypto.randomUUID().slice(0, 8)}`
    console.log(
      `[PAYMENT STUB] Airtel Money Collection: ${params.currency} ${params.amount / 100} to ${params.phone} (ref: ${providerRef})`,
    )
    return { providerRef }
  },

  async withdraw(params: WithdrawParams) {
    const providerRef = `stub-airtel-${crypto.randomUUID().slice(0, 8)}`
    console.log(
      `[PAYMENT STUB] Airtel Money Disbursement: ${params.currency} ${params.amount / 100} to ${params.phone} (ref: ${providerRef})`,
    )
    return { providerRef }
  },
}
```

- [ ] **Step 5: Create `apps/api/src/services/providers/index.ts`**

```typescript
import { mpesaProvider } from './mpesa.provider.js'
import { mtnProvider } from './mtn.provider.js'
import { airtelProvider } from './airtel.provider.js'
import type { PaymentProvider } from './provider.interface.js'
import { AppError } from '../../lib/errors.js'

const PROVIDERS: Record<string, PaymentProvider> = {
  mpesa: mpesaProvider,
  mtn: mtnProvider,
  airtel: airtelProvider,
}

export function getProvider(name: string): PaymentProvider {
  const provider = PROVIDERS[name]
  if (!provider) throw new AppError('INVALID_PROVIDER', `Unknown provider: ${name}`, 400)
  return provider
}

export type { PaymentProvider }
```

- [ ] **Step 6: Build to verify TypeScript**

```bash
pnpm --filter api build
```
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/providers/
git commit -m "feat(api): add payment provider interface and stub adapters"
```

---

## Task 7: Payment service — deposit

**Files:**
- Create: `apps/api/src/services/payment.service.test.ts`
- Create: `apps/api/src/services/payment.service.ts`

**Context:** `initiateDeposit` checks limits from `country_settings` (not `wallet_limits`), inserts a `payment_transactions` row, calls the stub provider, then updates the row to `awaiting_callback`. `confirmDeposit` credits the wallet inside a PG transaction.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/services/payment.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('./wallet.service.js', () => ({
  creditDeposit: vi.fn(async () => ({ transactionId: 'tx-1', walletId: 'w-1' })),
  lockForWithdrawal: vi.fn(async () => ({ walletId: 'w-1' })),
  settleWithdrawal: vi.fn(async () => undefined),
  getWalletBalance: vi.fn(async () => ({
    walletId: 'w-1', balance: 100000, bonusBalance: 0, lockedBalance: 0, currency: 'KES',
  })),
}))
vi.mock('./providers/index.js', () => ({
  getProvider: vi.fn(() => ({
    name: 'mpesa',
    deposit: vi.fn(async () => ({ providerRef: 'stub-ref-001' })),
    withdraw: vi.fn(async () => ({ providerRef: 'stub-ref-002' })),
  })),
}))

import { pool } from '@betting/db'
import { creditDeposit, settleWithdrawal } from './wallet.service.js'
import { initiateDeposit, confirmDeposit } from './payment.service.js'

const mockQuery = vi.mocked(pool.query)
const mockConnect = vi.mocked(pool.connect)

function makeMockClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  }
}

beforeEach(() => {
  mockQuery.mockReset()
  mockConnect.mockReset()
  vi.mocked(creditDeposit).mockReset()
  vi.mocked(settleWithdrawal).mockReset()
})

describe('initiateDeposit', () => {
  it('returns transactionId and providerRef on success', async () => {
    // player lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'player-1', phone: '+254700000000', currency: 'KES', country: 'KE' }],
    } as any)
    // country_settings lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{ min_deposit: 10000, max_deposit: 15000000 }],
    } as any)
    // INSERT payment_transactions
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'pt-1' }] } as any)
    // UPDATE awaiting_callback
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const result = await initiateDeposit('player-1', 50000, 'mpesa')

    expect(result.transactionId).toBe('pt-1')
    expect(result.providerRef).toBe('stub-ref-001')
  })

  it('throws LIMIT_EXCEEDED when amount below min_deposit', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'player-1', phone: '+254700000000', currency: 'KES', country: 'KE' }],
    } as any)
    mockQuery.mockResolvedValueOnce({
      rows: [{ min_deposit: 10000, max_deposit: 15000000 }],
    } as any)

    await expect(initiateDeposit('player-1', 500, 'mpesa')).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
  })

  it('returns existing record for duplicate idempotency key', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'player-1', phone: '+254700000000', currency: 'KES', country: 'KE' }],
    } as any)
    mockQuery.mockResolvedValueOnce({
      rows: [{ min_deposit: 10000, max_deposit: 15000000 }],
    } as any)
    // INSERT fails with unique constraint → simulate by returning existing row
    const err = Object.assign(new Error('unique'), { code: '23505' })
    mockQuery.mockRejectedValueOnce(err)
    // Fallback SELECT
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'pt-existing', provider_ref: 'stub-ref-old', status: 'awaiting_callback' }],
    } as any)

    const result = await initiateDeposit('player-1', 50000, 'mpesa')
    expect(result.transactionId).toBe('pt-existing')
  })
})

describe('confirmDeposit', () => {
  it('credits wallet and marks payment completed on success', async () => {
    const client = makeMockClient()
    mockConnect.mockResolvedValueOnce(client as any)

    // SELECT payment_transactions FOR UPDATE
    client.query
      .mockResolvedValueOnce({ rows: [] } as any) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'pt-1', player_id: 'player-1', amount: 50000, status: 'awaiting_callback' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE status=completed
      .mockResolvedValueOnce({ rows: [] } as any) // COMMIT

    vi.mocked(creditDeposit).mockResolvedValueOnce({ transactionId: 'tx-1', walletId: 'w-1' })

    await confirmDeposit('stub-ref-001', true)

    expect(creditDeposit).toHaveBeenCalledWith(
      client,
      'player-1',
      50000,
      expect.any(String),
      expect.any(Object),
    )
  })

  it('is idempotent — does nothing if already completed', async () => {
    const client = makeMockClient()
    mockConnect.mockResolvedValueOnce(client as any)

    client.query
      .mockResolvedValueOnce({ rows: [] } as any) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'pt-1', player_id: 'player-1', amount: 50000, status: 'completed' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // COMMIT

    await confirmDeposit('stub-ref-001', true)
    expect(creditDeposit).not.toHaveBeenCalled()
  })

  it('returns 200 without throwing when providerRef not found', async () => {
    const client = makeMockClient()
    mockConnect.mockResolvedValueOnce(client as any)

    client.query
      .mockResolvedValueOnce({ rows: [] } as any) // BEGIN
      .mockResolvedValueOnce({ rows: [] } as any) // SELECT → not found
      .mockResolvedValueOnce({ rows: [] } as any) // COMMIT

    await expect(confirmDeposit('unknown-ref', true)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter api test payment.service
```
Expected: FAIL — `initiateDeposit` not found

- [ ] **Step 3: Implement `apps/api/src/services/payment.service.ts`**

```typescript
import crypto from 'crypto'
import { pool } from '@betting/db'
import { AppError } from '../lib/errors.js'
import { getProvider } from './providers/index.js'
import { creditDeposit, lockForWithdrawal, settleWithdrawal } from './wallet.service.js'
import { calculateTax } from './tax.service.js'

// ─── Deposit ────────────────────────────────────────────────────────────────

export async function initiateDeposit(
  playerId: string,
  amount: number,
  providerName: string,
): Promise<{ transactionId: string; providerRef: string }> {
  // Load player
  const { rows: pRows } = await pool.query<{
    id: string; phone: string; currency: string; country: string
  }>(
    `SELECT id, phone, currency, country FROM players WHERE id = $1`,
    [playerId],
  )
  if (pRows.length === 0) throw new AppError('NOT_FOUND', 'Player not found', 404)
  const player = pRows[0]

  // Check limits
  const { rows: limitRows } = await pool.query<{ min_deposit: number; max_deposit: number }>(
    `SELECT min_deposit, max_deposit FROM country_settings WHERE country = $1`,
    [player.country],
  )
  if (limitRows.length > 0) {
    const { min_deposit, max_deposit } = limitRows[0]
    if (amount < Number(min_deposit)) {
      throw new AppError('LIMIT_EXCEEDED', `Minimum deposit is ${min_deposit}`, 422)
    }
    if (max_deposit != null && amount > Number(max_deposit)) {
      throw new AppError('LIMIT_EXCEEDED', `Maximum deposit is ${max_deposit}`, 422)
    }
  }

  const idempotencyKey = `deposit:${playerId}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`

  // Insert payment_transactions — handle duplicate key (idempotency)
  let paymentTxId: string
  let providerRef: string

  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO payment_transactions
         (player_id, wallet_id, type, provider, amount, currency, idempotency_key, status)
       VALUES ($1, (SELECT id FROM wallets WHERE player_id = $1), 'deposit', $2, $3, $4, $5, 'pending')
       RETURNING id`,
      [playerId, providerName, amount, player.currency, idempotencyKey],
    )
    paymentTxId = rows[0].id
  } catch (err: any) {
    if (err.code === '23505') {
      // Unique constraint — return existing record
      const { rows } = await pool.query<{ id: string; provider_ref: string }>(
        `SELECT id, provider_ref FROM payment_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
      return { transactionId: rows[0].id, providerRef: rows[0].provider_ref }
    }
    throw err
  }

  // Call provider
  const provider = getProvider(providerName)
  const result = await provider.deposit({
    playerId,
    phone: player.phone,
    amount,
    currency: player.currency,
    reference: paymentTxId,
  })
  providerRef = result.providerRef

  // Update to awaiting_callback
  await pool.query(
    `UPDATE payment_transactions
     SET status = 'awaiting_callback', provider_ref = $1, updated_at = NOW()
     WHERE id = $2`,
    [providerRef, paymentTxId],
  )

  return { transactionId: paymentTxId, providerRef }
}

export async function confirmDeposit(
  providerRef: string,
  success: boolean,
  failureReason?: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query<{
      id: string; player_id: string; amount: number; status: string
    }>(
      `SELECT id, player_id, amount, status FROM payment_transactions
       WHERE provider_ref = $1 FOR UPDATE`,
      [providerRef],
    )

    if (rows.length === 0) {
      // Unknown ref — log and return (provider may retry with delay)
      console.warn(`[payment] confirmDeposit: unknown providerRef ${providerRef}`)
      await client.query('COMMIT')
      return
    }

    const pt = rows[0]

    if (pt.status === 'completed' || pt.status === 'failed') {
      // Already settled — idempotent no-op
      await client.query('COMMIT')
      return
    }

    if (success) {
      await creditDeposit(client, pt.player_id, Number(pt.amount), pt.id, { providerRef })
      await client.query(
        `UPDATE payment_transactions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [pt.id],
      )
    } else {
      await client.query(
        `UPDATE payment_transactions
         SET status = 'failed', failure_reason = $1, updated_at = NOW()
         WHERE id = $2`,
        [failureReason ?? 'Provider declined', pt.id],
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Withdrawal ─────────────────────────────────────────────────────────────

export async function initiateWithdrawal(
  playerId: string,
  amount: number,
  providerName: string,
): Promise<{ transactionId: string; providerRef: string }> {
  const { rows: pRows } = await pool.query<{
    id: string; phone: string; currency: string; country: string
  }>(
    `SELECT id, phone, currency, country FROM players WHERE id = $1`,
    [playerId],
  )
  if (pRows.length === 0) throw new AppError('NOT_FOUND', 'Player not found', 404)
  const player = pRows[0]

  // Check limits
  const { rows: limitRows } = await pool.query<{
    min_withdrawal: number; max_withdrawal: number; daily_withdrawal_limit: number
  }>(
    `SELECT min_withdrawal, max_withdrawal, daily_withdrawal_limit
     FROM country_settings WHERE country = $1`,
    [player.country],
  )
  if (limitRows.length > 0) {
    const { min_withdrawal, max_withdrawal, daily_withdrawal_limit } = limitRows[0]
    if (amount < Number(min_withdrawal)) {
      throw new AppError('LIMIT_EXCEEDED', `Minimum withdrawal is ${min_withdrawal}`, 422)
    }
    if (max_withdrawal != null && amount > Number(max_withdrawal)) {
      throw new AppError('LIMIT_EXCEEDED', `Maximum withdrawal is ${max_withdrawal}`, 422)
    }
    if (daily_withdrawal_limit != null) {
      const { rows: dailyRows } = await pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM payment_transactions
         WHERE player_id = $1 AND type = 'withdrawal' AND status = 'completed'
         AND created_at >= (CURRENT_DATE AT TIME ZONE 'Africa/Nairobi')`,
        [playerId],
      )
      const dailyTotal = Number(dailyRows[0].total)
      if (dailyTotal + amount > Number(daily_withdrawal_limit)) {
        throw new AppError('LIMIT_EXCEEDED', 'Daily withdrawal limit exceeded', 422)
      }
    }
  }

  // Calculate withdrawal tax
  const { taxAmount, effectiveAmount: netPayout } = await calculateTax(
    player.country, 'withdrawal_tax', amount,
  )

  const idempotencyKey = `withdrawal:${playerId}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`

  // Lock funds and create payment record in one transaction
  const client = await pool.connect()
  let paymentTxId: string
  try {
    await client.query('BEGIN')
    const { walletId } = await lockForWithdrawal(client, playerId, amount)

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO payment_transactions
         (player_id, wallet_id, type, provider, amount, currency, idempotency_key, status)
       VALUES ($1, $2, 'withdrawal', $3, $4, $5, $6, 'pending')
       RETURNING id`,
      [playerId, walletId, providerName, amount, player.currency, idempotencyKey],
    )
    paymentTxId = rows[0].id
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  // Call provider (outside transaction — provider call must not block DB transaction)
  const provider = getProvider(providerName)
  const result = await provider.withdraw({
    playerId,
    phone: player.phone,
    amount: netPayout,
    currency: player.currency,
    reference: paymentTxId,
  })
  const providerRef = result.providerRef

  await pool.query(
    `UPDATE payment_transactions
     SET status = 'awaiting_callback', provider_ref = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [providerRef, paymentTxId],
  )

  // Store tax amount in metadata so confirmWithdrawal knows net payout
  await pool.query(
    `UPDATE payment_transactions
     SET failure_reason = NULL
     WHERE id = $1`,
    [paymentTxId],
  )

  // Cache netPayout and taxAmount in metadata column if it exists, else just store in memory
  // We'll pass netPayout through provider_ref lookup in confirmWithdrawal
  // Store in a separate column by recasting — simplest: store in failure_reason as JSON (unused at this stage)
  await pool.query(
    `UPDATE payment_transactions
     SET failure_reason = $1
     WHERE id = $2`,
    [JSON.stringify({ netPayout, taxAmount }), paymentTxId],
  )

  return { transactionId: paymentTxId, providerRef }
}

export async function confirmWithdrawal(
  providerRef: string,
  success: boolean,
  failureReason?: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query<{
      id: string; player_id: string; amount: number; status: string; failure_reason: string | null
    }>(
      `SELECT id, player_id, amount, status, failure_reason
       FROM payment_transactions WHERE provider_ref = $1 FOR UPDATE`,
      [providerRef],
    )

    if (rows.length === 0) {
      console.warn(`[payment] confirmWithdrawal: unknown providerRef ${providerRef}`)
      await client.query('COMMIT')
      return
    }

    const pt = rows[0]

    if (pt.status === 'completed' || pt.status === 'failed') {
      await client.query('COMMIT')
      return
    }

    // Parse cached netPayout from failure_reason field (set during initiation)
    const meta = pt.failure_reason ? JSON.parse(pt.failure_reason) : {}
    const netPayout = meta.netPayout ?? Number(pt.amount)

    await settleWithdrawal(client, pt.player_id, Number(pt.amount), netPayout, success, { providerRef })

    await client.query(
      `UPDATE payment_transactions
       SET status = $1, failure_reason = $2, updated_at = NOW()
       WHERE id = $3`,
      [success ? 'completed' : 'failed', success ? null : (failureReason ?? 'Provider declined'), pt.id],
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter api test payment.service
```
Expected: all tests passing

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/payment.service.ts apps/api/src/services/payment.service.test.ts
git commit -m "feat(api): add payment service with deposit and withdrawal flows"
```

---

## Task 8: Wallet routes

**Files:**
- Create: `apps/api/src/routes/wallet/balance.ts`
- Create: `apps/api/src/routes/wallet/deposit.ts`
- Create: `apps/api/src/routes/wallet/withdraw.ts`

- [ ] **Step 1: Create `apps/api/src/routes/wallet/balance.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { getWalletBalance } from '../../services/wallet.service.js'
import { AppError } from '../../lib/errors.js'

export async function walletBalanceRoutes(app: FastifyInstance) {
  app.get('/wallet/balance', { preHandler: authenticate }, async (req, reply) => {
    try {
      const wallet = await getWalletBalance(req.playerId)
      return reply.send({
        balance: wallet.balance,
        bonus_balance: wallet.bonusBalance,
        locked_balance: wallet.lockedBalance,
        currency: wallet.currency,
      })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })
}
```

- [ ] **Step 2: Create `apps/api/src/routes/wallet/deposit.ts`**

```typescript
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { initiateDeposit } from '../../services/payment.service.js'
import { AppError } from '../../lib/errors.js'

const body = z.object({
  amount: z.number().int().positive(),
  provider: z.enum(['mpesa', 'mtn', 'airtel']),
})

export async function walletDepositRoutes(app: FastifyInstance) {
  app.post('/wallet/deposit', { preHandler: authenticate }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    try {
      const result = await initiateDeposit(req.playerId, parsed.data.amount, parsed.data.provider)
      return reply.status(202).send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })
}
```

- [ ] **Step 3: Create `apps/api/src/routes/wallet/withdraw.ts`**

```typescript
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../middleware/authenticate.js'
import { initiateWithdrawal } from '../../services/payment.service.js'
import { AppError } from '../../lib/errors.js'

const body = z.object({
  amount: z.number().int().positive(),
  provider: z.enum(['mpesa', 'mtn', 'airtel']),
})

export async function walletWithdrawRoutes(app: FastifyInstance) {
  app.post('/wallet/withdraw', { preHandler: authenticate }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    try {
      const result = await initiateWithdrawal(req.playerId, parsed.data.amount, parsed.data.provider)
      return reply.status(202).send(result)
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })
}
```

- [ ] **Step 4: Build**

```bash
pnpm --filter api build
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/wallet/
git commit -m "feat(api): add wallet balance, deposit, and withdraw routes"
```

---

## Task 9: Webhook handlers + stub endpoint

**Files:**
- Create: `apps/api/src/routes/webhooks/mpesa.ts`
- Create: `apps/api/src/routes/webhooks/mtn.ts`
- Create: `apps/api/src/routes/webhooks/airtel.ts`
- Create: `apps/api/src/routes/webhooks/stub.ts`

**Context:** In production, each provider POSTs a callback to its webhook. For stubs, `POST /webhooks/stub/complete` allows manual triggering in dev/staging. All webhook handlers return 200 even on errors — providers interpret non-200 as failure and retry.

- [ ] **Step 1: Create `apps/api/src/routes/webhooks/mpesa.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { confirmDeposit, confirmWithdrawal } from '../../services/payment.service.js'

// M-Pesa STK Push callback body (simplified)
interface MpesaCallback {
  Body: {
    stkCallback: {
      MerchantRequestID: string
      CheckoutRequestID: string
      ResultCode: number
      ResultDesc: string
    }
  }
}

export async function mpesaWebhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/mpesa', async (req, reply) => {
    try {
      const body = req.body as MpesaCallback
      const { CheckoutRequestID, ResultCode, ResultDesc } = body.Body.stkCallback
      const success = ResultCode === 0

      // CheckoutRequestID is what we stored as provider_ref
      await confirmDeposit(CheckoutRequestID, success, success ? undefined : ResultDesc)
    } catch (err) {
      // Log but always return 200 — M-Pesa retries on non-200
      app.log.error(err, 'mpesa webhook error')
    }
    return reply.status(200).send({ ResultCode: 0, ResultDesc: 'Accepted' })
  })
}
```

- [ ] **Step 2: Create `apps/api/src/routes/webhooks/mtn.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { confirmDeposit, confirmWithdrawal } from '../../services/payment.service.js'

interface MtnCallback {
  referenceId: string
  status: 'SUCCESSFUL' | 'FAILED'
  reason?: string
  type: 'deposit' | 'withdrawal'
}

export async function mtnWebhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/mtn', async (req, reply) => {
    try {
      const body = req.body as MtnCallback
      const success = body.status === 'SUCCESSFUL'

      if (body.type === 'deposit') {
        await confirmDeposit(body.referenceId, success, body.reason)
      } else {
        await confirmWithdrawal(body.referenceId, success, body.reason)
      }
    } catch (err) {
      app.log.error(err, 'mtn webhook error')
    }
    return reply.status(200).send()
  })
}
```

- [ ] **Step 3: Create `apps/api/src/routes/webhooks/airtel.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { confirmDeposit, confirmWithdrawal } from '../../services/payment.service.js'

interface AirtelCallback {
  transaction: {
    id: string
    status: 'TS' | 'TF'  // TS = success, TF = failed
    message: string
    type: 'deposit' | 'withdrawal'
  }
}

export async function airtelWebhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/airtel', async (req, reply) => {
    try {
      const body = req.body as AirtelCallback
      const { id, status, message, type } = body.transaction
      const success = status === 'TS'

      if (type === 'deposit') {
        await confirmDeposit(id, success, success ? undefined : message)
      } else {
        await confirmWithdrawal(id, success, success ? undefined : message)
      }
    } catch (err) {
      app.log.error(err, 'airtel webhook error')
    }
    return reply.status(200).send()
  })
}
```

- [ ] **Step 4: Create `apps/api/src/routes/webhooks/stub.ts`**

```typescript
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { confirmDeposit, confirmWithdrawal } from '../../services/payment.service.js'

const body = z.object({
  transactionId: z.string().uuid(),
  success: z.boolean().default(true),
  failureReason: z.string().optional(),
})

export async function stubWebhookRoutes(app: FastifyInstance) {
  // Only register in non-production
  if (process.env.NODE_ENV === 'production') return

  app.post('/webhooks/stub/complete', async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    const { transactionId, success, failureReason } = parsed.data

    const { rows } = await pool.query<{ type: string; provider_ref: string; status: string }>(
      `SELECT type, provider_ref, status FROM payment_transactions WHERE id = $1`,
      [transactionId],
    )

    if (rows.length === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Transaction not found' } })
    }

    const pt = rows[0]

    if (pt.status === 'completed' || pt.status === 'failed') {
      return reply.send({ message: `Already ${pt.status}` })
    }

    if (!pt.provider_ref) {
      return reply.status(400).send({ error: { code: 'NO_PROVIDER_REF', message: 'No provider_ref yet' } })
    }

    if (pt.type === 'deposit') {
      await confirmDeposit(pt.provider_ref, success, failureReason)
    } else {
      await confirmWithdrawal(pt.provider_ref, success, failureReason)
    }

    return reply.send({ message: success ? 'confirmed' : 'failed', transactionId })
  })
}
```

- [ ] **Step 5: Build**

```bash
pnpm --filter api build
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/webhooks/
git commit -m "feat(api): add webhook handlers for M-Pesa, MTN, Airtel and stub endpoint"
```

---

## Task 10: Provider wallet API — HMAC middleware + routes

**Files:**
- Create: `apps/api/src/middleware/authenticate-provider.ts`
- Create: `apps/api/src/routes/provider/balance.ts`
- Create: `apps/api/src/routes/provider/debit.ts`
- Create: `apps/api/src/routes/provider/credit.ts`
- Create: `apps/api/src/routes/provider/rollback.ts`

**Context:** Each provider request must include `X-Provider-ID`, `X-Timestamp`, `X-Signature` headers. Signature = `HMAC-SHA256(secret, providerId + timestamp + method + path + bodyHash)`. Secret stored in env var `PROVIDER_SECRET_<PROVIDER_ID_UPPERCASED>`. Requests older than 60 seconds are rejected.

- [ ] **Step 1: Create `apps/api/src/middleware/authenticate-provider.ts`**

```typescript
import crypto from 'crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    providerId: string
  }
}

export async function authenticateProvider(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const providerId = req.headers['x-provider-id'] as string | undefined
  const timestamp = req.headers['x-timestamp'] as string | undefined
  const signature = req.headers['x-signature'] as string | undefined

  if (!providerId || !timestamp || !signature) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing auth headers' } })
    return
  }

  const tsNum = parseInt(timestamp, 10)
  const nowSec = Math.floor(Date.now() / 1000)
  if (isNaN(tsNum) || Math.abs(nowSec - tsNum) > 60) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Request expired' } })
    return
  }

  const secret = process.env[`PROVIDER_SECRET_${providerId.toUpperCase()}`]
  if (!secret) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unknown provider' } })
    return
  }

  const bodyStr = req.body ? JSON.stringify(req.body) : ''
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex')
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${providerId}${timestamp}${req.method}${req.url}${bodyHash}`)
    .digest('hex')

  // Constant-time comparison — both must be same length
  const sigBuf = Buffer.from(signature.padEnd(64, '0').slice(0, 64))
  const expBuf = Buffer.from(expected)

  if (signature.length !== expected.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    reply.status(401).send({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } })
    return
  }

  req.providerId = providerId
}
```

- [ ] **Step 2: Create `apps/api/src/routes/provider/balance.ts`**

```typescript
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticateProvider } from '../../middleware/authenticate-provider.js'
import { getWalletBalance } from '../../services/wallet.service.js'
import { AppError } from '../../lib/errors.js'

const query = z.object({
  playerId: z.string().uuid(),
})

export async function providerBalanceRoutes(app: FastifyInstance) {
  app.get('/provider/balance', { preHandler: authenticateProvider }, async (req, reply) => {
    const parsed = query.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    try {
      const wallet = await getWalletBalance(parsed.data.playerId)
      return reply.send({ balance: wallet.balance, currency: wallet.currency })
    } catch (err) {
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })
}
```

- [ ] **Step 3: Create `apps/api/src/routes/provider/debit.ts`**

```typescript
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateProvider } from '../../middleware/authenticate-provider.js'
import { debitForBet } from '../../services/wallet.service.js'
import { calculateTax, recordTax } from '../../services/tax.service.js'
import { AppError } from '../../lib/errors.js'

const body = z.object({
  playerId: z.string().uuid(),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  roundId: z.string(),
  gameId: z.string(),
  transactionRef: z.string(),
})

export async function providerDebitRoutes(app: FastifyInstance) {
  app.post('/provider/debit', { preHandler: authenticateProvider }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    const { playerId, amount, roundId, gameId, transactionRef } = parsed.data

    // Check idempotency
    const { rows: existing } = await pool.query<{ id: string; balance_after: number }>(
      `SELECT id, balance_after FROM transactions WHERE idempotency_key = $1`,
      [transactionRef],
    )
    if (existing.length > 0) {
      return reply.send({
        balance: Number(existing[0].balance_after),
        transactionId: existing[0].id,
      })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Get player country for tax
      const { rows: pRows } = await client.query<{ country: string }>(
        `SELECT country FROM players WHERE id = $1`,
        [playerId],
      )
      if (pRows.length === 0) throw new AppError('NOT_FOUND', 'Player not found', 404)
      const country = pRows[0].country

      const { taxAmount, effectiveAmount } = await calculateTax(country, 'wager_tax', amount)

      const { transactionId, walletId } = await debitForBet(
        client, playerId, amount, effectiveAmount,
        { roundId, gameId, provider: req.providerId, transactionRef },
      )

      // Update idempotency key on the transaction we just inserted
      await client.query(
        `UPDATE transactions SET idempotency_key = $1 WHERE id = $2`,
        [transactionRef, transactionId],
      )

      if (taxAmount > 0) {
        await recordTax(client, { playerId, taxAmount, taxType: 'wager_tax', country, transactionId })
      }

      const { rows: wRows } = await client.query<{ balance: string }>(
        `SELECT balance FROM wallets WHERE player_id = $1`,
        [playerId],
      )

      await client.query('COMMIT')

      return reply.send({ balance: Number(wRows[0].balance), transactionId })
    } catch (err) {
      await client.query('ROLLBACK')
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    } finally {
      client.release()
    }
  })
}
```

- [ ] **Step 4: Create `apps/api/src/routes/provider/credit.ts`**

```typescript
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateProvider } from '../../middleware/authenticate-provider.js'
import { creditWinnings } from '../../services/wallet.service.js'
import { AppError } from '../../lib/errors.js'

const body = z.object({
  playerId: z.string().uuid(),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  roundId: z.string(),
  gameId: z.string(),
  transactionRef: z.string(),
})

export async function providerCreditRoutes(app: FastifyInstance) {
  app.post('/provider/credit', { preHandler: authenticateProvider }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    const { playerId, amount, roundId, gameId, transactionRef } = parsed.data

    // Check idempotency
    const { rows: existing } = await pool.query<{ id: string; balance_after: number }>(
      `SELECT id, balance_after FROM transactions WHERE idempotency_key = $1`,
      [transactionRef],
    )
    if (existing.length > 0) {
      return reply.send({ balance: Number(existing[0].balance_after), transactionId: existing[0].id })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { transactionId } = await creditWinnings(
        client, playerId, amount,
        { roundId, gameId, provider: req.providerId, transactionRef },
      )

      await client.query(
        `UPDATE transactions SET idempotency_key = $1 WHERE id = $2`,
        [transactionRef, transactionId],
      )

      const { rows: wRows } = await client.query<{ balance: string }>(
        `SELECT balance FROM wallets WHERE player_id = $1`,
        [playerId],
      )

      await client.query('COMMIT')
      return reply.send({ balance: Number(wRows[0].balance), transactionId })
    } catch (err) {
      await client.query('ROLLBACK')
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    } finally {
      client.release()
    }
  })
}
```

- [ ] **Step 5: Create `apps/api/src/routes/provider/rollback.ts`**

```typescript
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateProvider } from '../../middleware/authenticate-provider.js'
import { refundBet } from '../../services/wallet.service.js'
import { AppError } from '../../lib/errors.js'

const body = z.object({
  playerId: z.string().uuid(),
  originalTransactionRef: z.string(),
  transactionRef: z.string(),
})

export async function providerRollbackRoutes(app: FastifyInstance) {
  app.post('/provider/rollback', { preHandler: authenticateProvider }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
      })
    }

    const { playerId, originalTransactionRef, transactionRef } = parsed.data

    // Check if already rolled back (idempotency on transactionRef)
    const { rows: existingRollback } = await pool.query<{ balance_after: number; id: string }>(
      `SELECT id, balance_after FROM transactions WHERE idempotency_key = $1`,
      [transactionRef],
    )
    if (existingRollback.length > 0) {
      return reply.send({
        balance: Number(existingRollback[0].balance_after),
        transactionId: existingRollback[0].id,
      })
    }

    // Find original transaction
    const { rows: origRows } = await pool.query<{ id: string; amount: number }>(
      `SELECT id, amount FROM transactions WHERE idempotency_key = $1`,
      [originalTransactionRef],
    )
    if (origRows.length === 0) {
      return reply.status(404).send({
        error: { code: 'TRANSACTION_NOT_FOUND', message: 'Original transaction not found' },
      })
    }

    const { amount } = origRows[0]

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { transactionId } = await refundBet(
        client, playerId, Number(amount),
        { originalTransactionRef, provider: req.providerId },
      )

      await client.query(
        `UPDATE transactions SET idempotency_key = $1 WHERE id = $2`,
        [transactionRef, transactionId],
      )

      const { rows: wRows } = await client.query<{ balance: string }>(
        `SELECT balance FROM wallets WHERE player_id = $1`,
        [playerId],
      )

      await client.query('COMMIT')
      return reply.send({ balance: Number(wRows[0].balance), transactionId })
    } catch (err) {
      await client.query('ROLLBACK')
      if (err instanceof AppError) {
        return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    } finally {
      client.release()
    }
  })
}
```

- [ ] **Step 6: Build**

```bash
pnpm --filter api build
```
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/middleware/authenticate-provider.ts apps/api/src/routes/provider/
git commit -m "feat(api): add provider wallet API with HMAC auth"
```

---

## Task 11: Daily tax reconciliation cron

**Files:**
- Create: `apps/api/src/lib/cron.ts`

**Context:** Runs at 21:00 UTC (midnight EAT) every day. For each country that has a enabled tax rule, aggregates `tax_transactions` for today, inserts `tax_remittances`, and inserts `ledger_closes`. Skips if `ledger_closes` already exists for that date+country.

- [ ] **Step 1: Create `apps/api/src/lib/cron.ts`**

```typescript
import cron from 'node-cron'
import { pool } from '@betting/db'

async function runDailyReconciliation(): Promise<void> {
  console.log('[cron] Starting daily tax reconciliation...')

  // Get all countries that have at least one enabled tax rule
  const { rows: countries } = await pool.query<{ country: string }>(
    `SELECT DISTINCT country FROM tax_rules WHERE enabled = true`,
  )

  for (const { country } of countries) {
    // Check if already closed for today
    const { rows: existing } = await pool.query(
      `SELECT id FROM ledger_closes
       WHERE date = CURRENT_DATE AND country = $1`,
      [country],
    )
    if (existing.length > 0) {
      console.log(`[cron] ${country}: already reconciled today, skipping`)
      continue
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Aggregate tax_transactions for today grouped by tax_type
      const { rows: aggregates } = await client.query<{
        tax_type: string
        total_amount: string
        transaction_count: string
      }>(
        `SELECT tax_type,
                SUM(amount) AS total_amount,
                COUNT(*) AS transaction_count
         FROM tax_transactions
         WHERE country = $1
           AND created_at >= CURRENT_DATE AT TIME ZONE 'Africa/Nairobi'
           AND created_at < (CURRENT_DATE + INTERVAL '1 day') AT TIME ZONE 'Africa/Nairobi'
         GROUP BY tax_type`,
        [country],
      )

      for (const agg of aggregates) {
        await client.query(
          `INSERT INTO tax_remittances
             (date, country, tax_type, total_amount, transaction_count, status)
           VALUES (CURRENT_DATE, $1, $2, $3, $4, 'pending_approval')
           ON CONFLICT DO NOTHING`,
          [country, agg.tax_type, agg.total_amount, agg.transaction_count],
        )
      }

      await client.query(
        `INSERT INTO ledger_closes (date, country, closed_by)
         VALUES (CURRENT_DATE, $1, 'system')`,
        [country],
      )

      await client.query('COMMIT')
      console.log(`[cron] ${country}: reconciliation complete (${aggregates.length} tax types)`)
    } catch (err) {
      await client.query('ROLLBACK')
      console.error(`[cron] ${country}: reconciliation failed`, err)
    } finally {
      client.release()
    }
  }

  console.log('[cron] Daily tax reconciliation done.')
}

export function startCron(): void {
  // 21:00 UTC = midnight EAT (UTC+3)
  cron.schedule('0 21 * * *', () => {
    runDailyReconciliation().catch(err => {
      console.error('[cron] Unhandled reconciliation error', err)
    })
  })
  console.log('[cron] Daily tax reconciliation scheduled at 21:00 UTC')
}
```

- [ ] **Step 2: Build**

```bash
pnpm --filter api build
```
Expected: no errors. If `node-cron` types are not found, run `pnpm --filter api add -D @types/node-cron` again.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/cron.ts
git commit -m "feat(api): add daily tax reconciliation cron"
```

---

## Task 12: Update env.ts, vitest.config.ts, and wire everything into server.ts

**Files:**
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/vitest.config.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/index.ts`

**Context:** No new required env vars for the stub providers. `PROVIDER_SECRET_*` vars are optional and looked up dynamically in the HMAC middleware. Wire all new routes into `buildServer()` and start the cron in `main()`.

- [ ] **Step 1: Update `apps/api/src/server.ts`**

Add these imports at the top after existing imports:

```typescript
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
```

Register them inside `buildServer()` after the existing `app.register(playerMeRoutes)` call:

```typescript
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
```

- [ ] **Step 2: Update `apps/api/src/index.ts`** — start the cron after migrations

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

- [ ] **Step 3: Build**

```bash
pnpm --filter api build
```
Expected: no errors

- [ ] **Step 4: Run all tests**

```bash
pnpm --filter api test
```
Expected: all passing (tax, wallet, payment, otp, admin-auth service tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/index.ts
git commit -m "feat(api): wire wallet/payment/provider routes and start tax cron"
```

---

## Task 13: Push and verify deploy

- [ ] **Step 1: Push branch**

```bash
git push origin feature/phase-3a
```

- [ ] **Step 2: Trigger Render deploy**

```bash
curl -s -X POST "https://api.render.com/v1/services/srv-d7eb279o3t8c73ebvvdg/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"clearCache": "do_not_clear"}'
```

- [ ] **Step 3: Verify health**

```bash
curl https://wingubid-api.onrender.com/health
```
Expected: `{"status":"ok"}`

- [ ] **Step 4: Smoke test deposit flow**

Register a player or use an existing one. Get an access token. Then:

```bash
# Get wallet balance
curl -H "Authorization: Bearer <access_token>" \
  https://wingubid-api.onrender.com/wallet/balance

# Initiate deposit
curl -X POST \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100000, "provider": "mpesa"}' \
  https://wingubid-api.onrender.com/wallet/deposit
# Expected: {"transactionId": "...", "providerRef": "stub-mpesa-..."}

# Trigger stub callback to confirm deposit
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"transactionId": "<transactionId from above>", "success": true}' \
  https://wingubid-api.onrender.com/webhooks/stub/complete
# Expected: {"message": "confirmed", "transactionId": "..."}

# Check balance increased
curl -H "Authorization: Bearer <access_token>" \
  https://wingubid-api.onrender.com/wallet/balance
# Expected: balance = 100000
```

- [ ] **Step 5: Commit any fixes found during smoke test, then final commit**

```bash
git add -A
git commit -m "fix(api): <describe any smoke test fixes>"
git push origin feature/phase-3a
```
