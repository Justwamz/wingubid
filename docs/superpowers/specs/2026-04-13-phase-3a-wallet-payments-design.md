# Phase 3a: Wallet & Payments Design Spec

**Date:** 2026-04-13
**Status:** Approved
**Depends on:** Phase 2 (auth system, player accounts, wallet schema)

---

## 1. Overview

Implement the player wallet system: balance operations, M-Pesa / MTN MoMo / Airtel Money deposits and withdrawals (stub adapters for MVP), tax engine (wager tax + withdrawal tax), transaction ledger, seamless wallet API for third-party game providers, and daily tax reconciliation cron.

Payment provider adapters are stubs for now — they log calls and return mock success. A stub webhook endpoint allows end-to-end testing of the full deposit/withdrawal flow without real provider credentials. Real provider wiring is a separate follow-on task.

---

## 2. Architecture

All wallet logic lives in `apps/api`. No new packages.

### 2.1 File Map

```
apps/api/src/
├── services/
│   ├── wallet.service.ts             # balance read, debit, credit, lock/unlock
│   ├── payment.service.ts            # deposit/withdraw orchestration, idempotency
│   ├── tax.service.ts                # wager + withdrawal tax calculation
│   └── providers/
│       ├── provider.interface.ts     # PaymentProvider interface
│       ├── mpesa.provider.ts         # stub — logs, returns mock success
│       ├── mtn.provider.ts           # stub
│       └── airtel.provider.ts        # stub
├── routes/
│   ├── wallet/
│   │   ├── balance.ts                # GET /wallet/balance
│   │   ├── deposit.ts                # POST /wallet/deposit
│   │   └── withdraw.ts               # POST /wallet/withdraw
│   ├── webhooks/
│   │   ├── mpesa.ts                  # POST /webhooks/mpesa
│   │   ├── mtn.ts                    # POST /webhooks/mtn
│   │   ├── airtel.ts                 # POST /webhooks/airtel
│   │   └── stub.ts                   # POST /webhooks/stub/complete (dev/test only)
│   └── provider/                     # seamless wallet API for slots/virtual sports
│       ├── balance.ts                # GET /provider/balance
│       ├── debit.ts                  # POST /provider/debit
│       ├── credit.ts                 # POST /provider/credit
│       └── rollback.ts               # POST /provider/rollback
└── lib/
    ├── idempotency.ts                # idempotency key check/store (PostgreSQL)
    └── cron.ts                       # node-cron daily tax reconciliation

packages/db/migrations/
├── 010_tax_config.sql
├── 011_tax_transactions.sql
├── 012_ledger_closes.sql
├── 013_tax_remittances.sql
├── 014_payment_transactions.sql
└── 015_wallet_limits.sql
```

---

## 3. Database Schema

### 3.1 `tax_config`
```sql
CREATE TABLE tax_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country     CHAR(2) NOT NULL,          -- 'KE', 'UG', 'TZ', 'RW'
  tax_type    VARCHAR(20) NOT NULL,       -- 'wager_tax' | 'withdrawal_tax'
  rate_bps    INTEGER NOT NULL,           -- basis points, e.g. 1250 = 12.5%
  enabled     BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES admins(id),
  UNIQUE(country, tax_type)
);
```

Seed data: Kenya wager_tax 1250 bps enabled, withdrawal_tax 2000 bps enabled. All other countries disabled.

### 3.2 `tax_transactions`
```sql
CREATE TABLE tax_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID NOT NULL REFERENCES players(id),
  amount         BIGINT NOT NULL,         -- smallest currency unit
  tax_type       VARCHAR(20) NOT NULL,
  country        CHAR(2) NOT NULL,
  transaction_id UUID NOT NULL,           -- references transactions(id)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.3 `ledger_closes`
```sql
CREATE TABLE ledger_closes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date       DATE NOT NULL,
  country    CHAR(2) NOT NULL,
  closed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by  VARCHAR(20) NOT NULL DEFAULT 'system',
  UNIQUE(date, country)
);
```

### 3.4 `tax_remittances`
```sql
CREATE TABLE tax_remittances (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date              DATE NOT NULL,
  country           CHAR(2) NOT NULL,
  tax_type          VARCHAR(20) NOT NULL,
  total_amount      BIGINT NOT NULL,
  transaction_count INTEGER NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending_approval',
  -- 'pending_approval' | 'approved' | 'disputed'
  approved_by       UUID REFERENCES admins(id),
  approved_at       TIMESTAMPTZ,
  dispute_reason    TEXT,
  payment_reference VARCHAR(255),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.5 `payment_transactions`
```sql
CREATE TABLE payment_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        UUID NOT NULL REFERENCES players(id),
  type             VARCHAR(20) NOT NULL,  -- 'deposit' | 'withdrawal'
  provider         VARCHAR(20) NOT NULL,  -- 'mpesa' | 'mtn' | 'airtel'
  amount           BIGINT NOT NULL,
  currency         CHAR(3) NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- 'pending' | 'awaiting_callback' | 'completed' | 'failed'
  idempotency_key  VARCHAR(255) UNIQUE NOT NULL,
  provider_ref     VARCHAR(255),          -- provider's transaction reference
  failure_reason   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 4. Wallet Service

`wallet.service.ts` is the single source of truth for balance mutations. Nothing else modifies wallet balances directly.

### 4.1 `debitWallet(client, playerId, amount, txType, meta)`
1. `SELECT id, balance, currency FROM wallets WHERE player_id = $1 FOR UPDATE`
2. If `balance < amount` → throw `AppError('INSUFFICIENT_FUNDS')`
3. `UPDATE wallets SET balance = balance - $1, locked_balance = locked_balance + $1`
4. `INSERT INTO transactions (player_id, type, amount, currency, ...meta)`
5. Returns `{ transactionId, newBalance }`

All steps run inside the caller's PostgreSQL transaction — `client` is passed in, not created internally.

### 4.2 `creditWallet(client, playerId, amount, txType, meta)`
1. `SELECT ... FOR UPDATE`
2. `UPDATE wallets SET balance = balance + $1`
3. `INSERT INTO transactions`
4. Returns `{ transactionId, newBalance }`

### 4.3 `releaseLockedBalance(client, playerId, amount, txType, meta)`
1. `SELECT ... FOR UPDATE`
2. `UPDATE wallets SET locked_balance = locked_balance - $1`
3. `INSERT INTO transactions`
4. Returns `{ transactionId }`

Used when a withdrawal fails — moves funds back from locked to available without changing the overall balance.

### 4.4 `getBalance(playerId)`
Simple read — no lock needed. Returns `{ balance, bonusBalance, lockedBalance, currency }`.

---

## 5. Tax Service

### 5.1 `calculateTax(country, taxType, grossAmount)`
1. `SELECT rate_bps, enabled FROM tax_config WHERE country = $1 AND tax_type = $2`
2. If not found or `enabled = false` → return `{ taxAmount: 0, effectiveAmount: grossAmount }`
3. `taxAmount = Math.floor(grossAmount * rate_bps / 10000)`
4. `effectiveAmount = grossAmount - taxAmount`
5. Returns `{ taxAmount, effectiveAmount, rateBps }`

### 5.2 `recordTax(client, playerId, taxAmount, taxType, country, transactionId)`
`INSERT INTO tax_transactions` within the caller's transaction.

---

## 6. Payment Provider Interface

```typescript
interface PaymentProvider {
  deposit(params: {
    playerId: string
    phone: string
    amount: number        // smallest currency unit
    currency: string
    reference: string     // our idempotency key
  }): Promise<{ providerRef: string }>

  withdraw(params: {
    playerId: string
    phone: string
    amount: number
    currency: string
    reference: string
  }): Promise<{ providerRef: string }>

  checkStatus(providerRef: string): Promise<{
    status: 'pending' | 'completed' | 'failed'
    failureReason?: string
  }>
}
```

### 6.1 Stub Implementations
All three stubs (`mpesa.provider.ts`, `mtn.provider.ts`, `airtel.provider.ts`) log the call and return:
```typescript
console.log(`[PAYMENT STUB] ${provider} ${method}: ${currency} ${amount/100} to ${phone}`)
return { providerRef: `stub-${Date.now()}-${Math.random().toString(36).slice(2)}` }
```

`checkStatus` always returns `{ status: 'pending' }` — callbacks drive status updates, not polling.

Provider selection by player country: KE → M-Pesa (default), UG/RW → MTN, TZ/UG/KE → Airtel (player chooses at deposit time).

---

## 7. Payment Service

### 7.1 Deposit Flow

`initiateDeposit(playerId, amount, provider)`

1. Load player (phone, currency, country)
2. Check `wallet_limits` for `min_deposit` / `max_deposit` for player's country → throw `LIMIT_EXCEEDED` if violated
3. Check idempotency: `SELECT FROM payment_transactions WHERE idempotency_key = $1` — if exists, return existing record
4. Insert `payment_transactions` row with status `pending`, idempotency_key = `${playerId}:deposit:${Date.now()}`
5. Call `provider.deposit(...)` → get `providerRef`
6. Update `payment_transactions` set `status = 'awaiting_callback'`, `provider_ref = providerRef`
7. Return `{ transactionId, providerRef }`

### 7.2 Deposit Callback (Webhook Handler)

`confirmDeposit(providerRef, success, failureReason?)`

1. `SELECT FROM payment_transactions WHERE provider_ref = $1 FOR UPDATE`
2. If not found → log warning, return 200 (provider retries must not cause errors)
3. If `status = 'completed'` → return 200 (idempotent — duplicate callback)
4. If `success`:
   - Open PostgreSQL transaction
   - `creditWallet(client, playerId, amount, 'deposit', { paymentTransactionId })`
   - Update `payment_transactions` status → `completed`
   - Commit
5. If `!success`:
   - Update `payment_transactions` status → `failed`, `failure_reason = failureReason`
6. Return 200

### 7.3 Withdrawal Flow

`initiateWithdrawal(playerId, amount, provider)`

1. Load player (phone, currency, country)
2. Check `wallet_limits` for `min_withdrawal` / `max_withdrawal` / `daily_withdrawal_limit`
   - Daily limit: sum all `completed` withdrawals for player today (calendar day in EAT, UTC+3)
3. Open PostgreSQL transaction:
   - `debitWallet(client, playerId, amount, 'withdrawal_pending', ...)` — moves to `locked_balance`
   - Insert `payment_transactions` with status `pending`
   - Commit
4. Call `provider.withdraw(...)` → get `providerRef`
5. Update `payment_transactions` status → `awaiting_callback`, `provider_ref = providerRef`
6. Return `{ transactionId, providerRef }`

### 7.4 Withdrawal Callback

`confirmWithdrawal(providerRef, success, failureReason?)`

1. `SELECT FROM payment_transactions WHERE provider_ref = $1 FOR UPDATE`
2. If `status = 'completed'` or `status = 'failed'` → return 200 (idempotent)
3. If `success`:
   - Open PostgreSQL transaction
   - `releaseLockedBalance(client, playerId, amount, 'withdrawal_completed', ...)`
   - Update `payment_transactions` status → `completed`
   - Commit
4. If `!success`:
   - Open PostgreSQL transaction
   - `releaseLockedBalance` + `creditWallet` effectively → return funds to `balance`
   - Actually: `UPDATE wallets SET balance = balance + $1, locked_balance = locked_balance - $1`
   - Insert `transactions` row with type `withdrawal_failed`
   - Update `payment_transactions` status → `failed`, `failure_reason = failureReason`
   - Commit

---

## 8. Stub Webhook Endpoint

`POST /webhooks/stub/complete` — only registered when `NODE_ENV !== 'production'`.

Body: `{ transactionId, success?: boolean, failureReason?: string }`

Looks up the payment transaction, calls `confirmDeposit` or `confirmWithdrawal` accordingly. Allows full end-to-end testing in development and staging without real provider credentials.

---

## 9. Provider Wallet API (Seamless Wallet)

Used by slots and virtual sports providers. Provider calls our API for every balance check and transaction — player money never leaves our wallet.

### 9.1 Authentication

Every request must include:
- `X-Provider-ID` header — identifies which provider
- `X-Timestamp` header — Unix timestamp
- `X-Signature` header — `HMAC-SHA256(providerSecret, providerId + timestamp + method + path + bodyHash)`

Middleware rejects requests where timestamp is older than 60 seconds or signature is invalid.

Provider secrets stored in env vars: `PROVIDER_SECRET_PRAGMATIC`, `PROVIDER_SECRET_KIRON`, etc.

### 9.2 Endpoints

**`GET /provider/balance`**
Query params: `playerId`, `currency`
Response: `{ balance: number, currency: string }` — balance in smallest unit

**`POST /provider/debit`**
Body: `{ playerId, amount, currency, roundId, gameId, transactionRef }`
1. Check idempotency via `transactionRef`
2. `calculateTax(country, 'wager_tax', amount)` — deduct tax
3. `debitWallet(client, playerId, effectiveAmount, 'bet_placed', { roundId, gameId })`
4. `recordTax(...)`
5. Response: `{ balance: newBalance, transactionId }`

**`POST /provider/credit`**
Body: `{ playerId, amount, currency, roundId, gameId, transactionRef }`
1. Check idempotency
2. `creditWallet(client, playerId, amount, 'bet_won', { roundId, gameId })`
3. Response: `{ balance: newBalance, transactionId }`

**`POST /provider/rollback`**
Body: `{ playerId, originalTransactionRef, transactionRef }`
1. Look up original transaction by `originalTransactionRef`
2. If already rolled back → return 200 (idempotent)
3. `creditWallet(client, playerId, originalAmount, 'bet_refunded', ...)` — reverses the debit
4. Response: `{ balance: newBalance, transactionId }`

---

## 10. Wallet Limits

`wallet_limits` table (seeded by admin, not migrated with defaults):
```sql
CREATE TABLE wallet_limits (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country               CHAR(2) NOT NULL UNIQUE,
  min_deposit           BIGINT NOT NULL,
  max_deposit           BIGINT NOT NULL,
  min_withdrawal        BIGINT NOT NULL,
  max_withdrawal        BIGINT NOT NULL,
  daily_withdrawal_limit BIGINT NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Seed data (amounts in smallest unit — KES cents):
- KE: min_deposit=10000 (KES 100), max_deposit=15000000 (KES 150,000), min_withdrawal=10000, max_withdrawal=15000000, daily=70000000 (KES 700,000)

---

## 11. Daily Tax Reconciliation Cron

`lib/cron.ts` registers a `node-cron` job on API startup: `0 21 * * *` (21:00 UTC = midnight EAT).

Steps:
1. For each enabled country in `tax_config`:
2. Check `ledger_closes` — skip if already closed for today
3. Aggregate `tax_transactions` for `date = today` grouped by `{ country, tax_type }`
4. Insert `tax_remittances` rows with `status = 'pending_approval'`
5. Insert `ledger_closes` row for `{ date, country }`

No email/SMS notification for MVP — finance admins check the dashboard.

`node-cron` dependency added to `apps/api/package.json`.

---

## 12. API Routes

### 12.1 Player-facing (requires player JWT)

| Method | Path | Description |
|---|---|---|
| GET | `/wallet/balance` | Current balance, locked, bonus |
| POST | `/wallet/deposit` | Initiate deposit |
| POST | `/wallet/withdraw` | Initiate withdrawal |

### 12.2 Webhooks (no auth — provider-specific HMAC or open)

| Method | Path | Description |
|---|---|---|
| POST | `/webhooks/mpesa` | M-Pesa STK callback |
| POST | `/webhooks/mtn` | MTN MoMo callback |
| POST | `/webhooks/airtel` | Airtel Money callback |
| POST | `/webhooks/stub/complete` | Dev/staging only — manual callback trigger |

### 12.3 Provider Wallet API (HMAC auth)

| Method | Path | Description |
|---|---|---|
| GET | `/provider/balance` | Player balance for provider |
| POST | `/provider/debit` | Debit player wallet (bet placed) |
| POST | `/provider/credit` | Credit player wallet (bet won) |
| POST | `/provider/rollback` | Rollback a failed debit |

---

## 13. Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `INSUFFICIENT_FUNDS` | 422 | Wallet balance too low |
| `LIMIT_EXCEEDED` | 422 | Below min, above max, or daily limit hit |
| `DUPLICATE_TRANSACTION` | 409 | Idempotency key already used |
| `PROVIDER_UNAVAILABLE` | 503 | Provider adapter threw unexpectedly |
| `INVALID_SIGNATURE` | 401 | Provider wallet API HMAC check failed |
| `TRANSACTION_NOT_FOUND` | 404 | Rollback references unknown transaction |

---

## 14. Testing Strategy

All tests use Vitest with mocked DB (`pool.query` mocked via `vi.mock('@betting/db')`).

### Unit tests
- `tax.service.test.ts` — rate calculation, basis points rounding, disabled tax returns zero, zero-amount edge case
- `wallet.service.test.ts` — debit sufficient/insufficient funds, credit, release locked balance
- `payment.service.test.ts` — deposit orchestration, withdrawal orchestration, idempotency (duplicate key returns original), limit enforcement (min, max, daily)
- `idempotency.test.ts` — duplicate detection returns existing record

### Route-level tests (mocked DB, full request/response)
- Deposit route — happy path, limit exceeded, duplicate idempotency key
- Withdraw route — happy path, insufficient funds, daily limit exceeded
- Webhook handlers — valid callback credits wallet, duplicate callback returns 200 without re-processing, invalid body returns 400
- Provider wallet API — invalid HMAC returns 401, balance, debit with tax, credit, rollback
