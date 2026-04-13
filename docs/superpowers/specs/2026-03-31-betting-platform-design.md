ccd# Betting Platform — Design Spec

**Date:** 2026-03-31
**Status:** Approved
**Project:** Standalone — separate from SumsPOS

---

## 1. Overview

An online betting platform targeting Pan-Africa (Kenya, Uganda, Tanzania, Rwanda) offering casino and virtual sports products. MVP focus is on proving the core betting loop with real money. Intended for BCLB licensing (Kenya) and equivalent regional regulators.

**MVP product scope:**
- Crash game (custom-built, Aviator-style)
- Slots (third-party licensed provider)
- Virtual sports (third-party licensed provider)
- Player wallet with M-Pesa, MTN MoMo, and Airtel Money
- Admin back-office

**Out of scope for MVP:** live sports betting, ID document KYC upload, crypto payments, native mobile apps.

---

## 2. Architecture

### 2.1 Monorepo Structure

```
betting-platform/
├── apps/
│   ├── web/          # Next.js — player-facing frontend
│   ├── admin/        # Next.js — back-office (separate deploy)
│   └── api/          # Fastify — business logic, WebSockets, payment callbacks
├── packages/
│   ├── db/           # PostgreSQL schema, migrations, query helpers
│   └── types/        # Shared TypeScript types across all apps
├── package.json      # pnpm workspaces
```

### 2.2 Runtime Services (Render)

| Service | Type | Notes |
|---|---|---|
| `api` | Web service (always-on) | Fastify — REST + WebSockets |
| `web` | Web service | Next.js SSR — player app |
| `admin` | Web service | Next.js SSR — back-office |
| PostgreSQL | Managed database | Primary data store |
| Redis | Managed instance | Game state, sessions, rate limiting |

Minimum Starter paid tier on Render for `api` — free tier spins down idle services, which kills WebSocket connections.

### 2.3 Data Flow

- Player browser → `web` → `api` → PostgreSQL/Redis
- Crash game → persistent Socket.io connection on `api`
- Payment callbacks (M-Pesa, MTN, Airtel) → public webhook endpoints on `api`
- Admin browser → `admin` → same `api` (route prefix `/admin/*`, admin-only JWT)

Admin is a separate deploy with a separate URL. This makes it harder to probe admin endpoints and allows IP restriction later without affecting player traffic.

---

## 3. Auth & Player Accounts

### 3.1 Registration

- **Primary identifier:** phone number (not email)
- OTP verification via SMS (Africa's Talking or Twilio) on signup
- KYC-lite at signup: full name, date of birth, country — no ID document upload for MVP
- Age gate: player must confirm 18+ before completing registration
- Country detected at registration → maps to default currency (KE → KES, UG → UGX, TZ → TZS, RW → RWF)

### 3.2 Login

- Phone + password
- JWT access token: short-lived (15 min)
- Refresh token: 7-day expiry, stored in httpOnly cookie
- Refresh token rotation — previous token invalidated on each refresh
- Force logout invalidates all refresh tokens for the player

### 3.3 Player Account

Fields: `name`, `phone`, `country`, `currency`, `date_of_birth`, `status`, `created_at`

Account statuses:
- `active` — normal
- `suspended` — admin-imposed
- `self_excluded` — player-imposed, with an expiry date

Self-exclusion: player can lock their own account for a configurable period (7 days, 30 days, 90 days, permanent). Cannot be reversed by the player during the period — only super_admin can override in exceptional cases.

### 3.4 Admin Controls

- View player profile, wallet balance, login history
- Suspend / unsuspend / force logout
- Trigger self-exclusion on behalf of player

---

## 4. Wallet

### 4.1 Core Design

Each player has one wallet per currency (starts with their registration currency).

Wallet fields: `balance`, `bonus_balance`, `locked_balance`

- `balance` — available funds (withdrawable)
- `bonus_balance` — bonus funds, not directly withdrawable, converts to balance on wagering completion
- `locked_balance` — funds held in active bets, forfeited to house revenue on loss or released as winnings on win

All wallet amounts stored as integers in the smallest currency unit (e.g. cents) — no floating point money arithmetic.

All money operations append to a `transactions` ledger. The wallet balance is always reconcilable against the ledger.

### 4.2 Transaction Types

`deposit`, `withdrawal`, `bet_placed`, `bet_won`, `bet_refunded`, `bonus_credit`, `bonus_wager`, `wager_tax`, `withdrawal_tax`

### 4.3 Deposits

1. Player initiates deposit → selects amount
2. API sends STK Push / MoMo prompt to player's phone
3. Payment provider calls back to API webhook → transaction recorded → wallet credited
4. Idempotency key on every transaction — duplicate callbacks are safely ignored

### 4.4 Withdrawals

1. Player requests withdrawal → amount moved from `balance` to `locked_balance` immediately
2. API initiates B2C transfer to player's registered mobile number
3. Success callback → `locked_balance` decremented, transaction recorded as `completed`
4. Failure callback → `locked_balance` returned to `balance`, player notified

Manual override: finance admin can approve/retry failed withdrawals above a configurable threshold.

### 4.5 Payment Providers

Each provider is implemented as a standalone adapter module behind a shared interface (`deposit`, `withdraw`, `checkStatus`). Swapping or adding providers does not affect wallet logic.

| Provider | Country | Deposit Method | Withdrawal Method |
|---|---|---|---|
| M-Pesa | Kenya | Daraja STK Push | Daraja B2C |
| MTN MoMo | Uganda, Rwanda | Collections API | Disbursements API |
| Airtel Money | Uganda, Tanzania, Kenya | Collections API | Disbursements API |

### 4.6 Bonus System (MVP)

Welcome bonus only: deposit match (e.g. 100% up to KES 1,000) credited to `bonus_balance` on first deposit.

- Wagering requirement tracked per bonus grant (e.g. 10× the bonus amount must be wagered before conversion)
- Once requirement met → bonus balance converts to real balance automatically
- No multi-bonus stacking for MVP

### 4.7 Limits (Admin Configurable)

- Minimum / maximum deposit per transaction
- Minimum / maximum withdrawal per transaction
- Daily withdrawal limit per player
- All configurable per country by admin

---

## 5. Tax Engine

### 5.1 Tax Types

Two tax types apply to player transactions:

- `wager_tax` — deducted from the stake at bet placement
- `withdrawal_tax` — deducted from the withdrawal amount

### 5.2 Tax Configuration

Tax rules are configured per country by admin:

```
{ country, tax_type, rate (%), enabled }
```

Example defaults:
- Kenya: wager_tax 12.5%, withdrawal_tax 20%
- Uganda: configurable (disabled by default until rules are confirmed)
- Tanzania: configurable
- Rwanda: configurable

Rate and enabled/disabled status changes are logged with timestamp and admin identity (audit trail). Changes take effect immediately on the next applicable transaction.

### 5.3 Wager Tax Flow

1. Player places bet of KES 100
2. System checks Kenya wager tax config → 12.5% enabled
3. Tax amount: KES 12.50 deducted from stake
4. Effective bet stake: KES 87.50 locked in the bet
5. KES 12.50 recorded in `tax_transactions` as `wager_tax`
6. Player sees the breakdown (gross stake, tax, effective stake) before confirming

### 5.4 Withdrawal Tax Flow

1. Player withdraws KES 1,000
2. System checks Kenya withdrawal tax config → 20% enabled
3. Tax amount: KES 200 deducted
4. Player receives KES 800 via mobile money
5. KES 200 recorded in `tax_transactions` as `withdrawal_tax`
6. Player sees net amount before confirming

### 5.5 Tax Transactions Ledger

Every tax deduction recorded: `{ player_id, amount, tax_type, country, transaction_id, created_at }`

Used for daily reconciliation and KRA/regulator remittance reporting.

---

## 6. Daily Tax Reconciliation & Remittance

### 6.1 Automated Ledger Close

A cron job runs at **00:00 EAT** every day.

Steps:
1. Aggregate all `tax_transactions` for the day by `{ country, tax_type }`
2. Create a `tax_remittance` record per group: `{ date, country, tax_type, total_amount, status: 'pending_approval', transaction_count }`
3. Lock the ledger for that date by inserting a `ledger_close` record `{ date, country, closed_at, closed_by: 'system' }`. Any attempt to create a `tax_transaction` with a `created_at` date that has a matching `ledger_close` record is rejected at the API layer.
4. Notify all configured approvers (CFO role and above) via email + SMS with the full breakdown

The schedule is configurable per country (Kenya = midnight daily; other countries configurable or disabled).

### 6.2 Morning Approval Workflow

Finance dashboard shows all `pending_approval` remittances grouped by date and country.

Approver actions:
- **Approve** — requires second-factor confirmation (PIN or OTP). Status → `approved`. Payment instruction generated.
- **Dispute** — flags the remittance with a reason for super_admin review. Status → `disputed`.

Once approved:
- A structured payment instruction is generated: tax authority bank account, amount, reference number, date
- Instruction exported as CSV or PDF for upload to bank portal
- Future: direct banking API integration for automated transfer execution

### 6.3 Configurable Per Country

Each country has its own:
- Remittance cron schedule
- Tax authority bank account details (configured in admin settings)
- Enabled/disabled flag

### 6.4 Audit Trail

Every remittance record logs: calculated amount, approver identity, approval timestamp, payment reference number. Disputes log reason and resolution. This table is append-only.

---

## 7. Crash Game Engine

### 7.1 Overview

A multiplier starts at 1.00× and rises in real-time. The crash point is determined before the round starts. Players bet during a countdown, watch the multiplier rise, and manually cash out before it crashes. Failure to cash out before the crash loses the stake.

### 7.2 Provably Fair RNG

Crash point determined by:
```
crash_point = f(HMAC_SHA256(server_seed, client_seed + round_id))
```

- Server seed is committed (stored as a hash) before the round starts
- Full server seed revealed after the round ends
- Players can independently verify any past round's result
- Seeds and round results stored permanently in the database

### 7.3 Round Lifecycle

```
WAITING (5s countdown — bets accepted)
  → RUNNING (multiplier rising — cash-outs accepted)
    → CRASHED (result revealed — bets settled)
      → WAITING (next round begins immediately)
```

### 7.4 WebSocket Protocol (Socket.io)

All players share one room per game instance.

**Server → Client broadcasts:**
- `round:waiting` — new round starting, countdown begins
- `round:started` — multiplier now rising
- `round:tick` — multiplier update (every 100ms)
- `round:crashed` — crash point revealed, round over

**Client → Server:**
- `bet:place` — place a bet (during WAITING phase only)
- `bet:cashout` — cash out (during RUNNING phase only)

Current round state stored in Redis — survives API server restarts without losing in-flight bets.

### 7.5 Bet Settlement

- `bet:place` → deduct stake from wallet (wager tax applied), move stake to `locked_balance`, record bet with status `active`
- `bet:cashout` → calculate `winnings = effective_stake × cashout_multiplier`, credit wallet, mark bet `won`
- Round crashes → all `active` bets marked `lost`, `locked_balance` decremented (funds written off — house revenue is implicit in the RNG distribution, not an explicit wallet transfer)

### 7.6 Auto Cash-Out

Player sets a target multiplier — server cashes out automatically when reached. Stored and executed server-side. Client-side auto cash-out settings are not trusted.

### 7.7 House Edge

Controlled via the crash point distribution formula. Configurable house edge % in admin settings (default ~5%). Applied in the RNG formula — not by manipulating individual player outcomes.

---

## 8. Slots & Virtual Sports (Third-Party Integrations)

### 8.1 Integration Pattern: Seamless Wallet

Provider games are embedded as iframes in the `web` app. The provider calls our API for every balance check and bet transaction. All player money stays in our wallet — the provider never holds player balances.

**Provider-facing Wallet API:**

| Endpoint | Purpose |
|---|---|
| `GET /provider/balance` | Return player's current balance |
| `POST /provider/debit` | Deduct bet from wallet |
| `POST /provider/credit` | Add winnings to wallet |
| `POST /provider/rollback` | Reverse a failed transaction |

Each request authenticated via provider-specific HMAC signature (not player JWT). All provider transactions recorded in the `transactions` ledger. Tax rules apply to provider bets identically to crash game bets.

### 8.2 Slots

**Recommended provider:** Pragmatic Play (widely adopted in Africa, large catalogue)
**Fallback:** Habanero (simpler integration, lower minimum deal size — better if Pragmatic Play's deal terms are too large for MVP)

### 8.3 Virtual Sports

**Recommended provider:** Kiron Interactive (dominant in East Africa, used by major Kenyan operators)
**Fallback:** BetGames (simpler catalogue, easier onboarding)

### 8.4 Game Lobby

- `web` app shows a lobby per category: Slots, Virtual Sports
- Clicking a game → API generates a signed launch URL → provider iframe loads
- No game assets hosted by us — provider CDN handles everything

### 8.5 Admin Controls

- Enable/disable individual games or entire provider (takes effect immediately)
- View game session logs and transaction history per game

---

## 9. Admin Back-Office

### 9.1 Access Control

Admin accounts are separate from player accounts — no overlap.

Roles and permissions:

| Role | Permissions |
|---|---|
| `super_admin` | Full access including tax config, game config, role management |
| `finance` | Wallet operations, withdrawal approval, tax remittance approval, financial reports |
| `support` | Player profile, suspend/unsuspend, bet history, withdrawal retry |
| `reports` | Read-only access to all reports |

### 9.2 Player Management (support)

- Search by phone, name
- View profile, wallet balance, transaction history, bet history
- Suspend / unsuspend / force logout
- Process failed withdrawal manually
- Trigger self-exclusion on behalf of player

### 9.3 Financial Management (finance)

- View all deposits, withdrawals, pending payouts
- Approve / reject manual withdrawals above configurable threshold
- Tax remittance approval workflow (see Section 6)
- Provider settlement reports

### 9.4 Game Management (super_admin)

- Configure crash game house edge %
- Enable / disable games and providers
- Configure tax rules per country (rate, enabled/disabled)
- Set deposit and withdrawal limits per country (min, max, daily)
- Configure bonus: welcome bonus rate, wagering requirement multiplier

### 9.5 Reports (reports)

- GGR (Gross Gaming Revenue) by game type and date range
- Player activity: registrations, active players, churn
- Payment provider performance: success rates, failure reasons by provider
- Tax collected: by type, country, date range

### 9.6 Audit Log

Every admin action recorded: `{ admin_id, action, entity, before, after, timestamp }`. Append-only — no deletions or edits.

---

## 10. Error Handling

- All API errors return `{ error: { code, message } }` — consistent across all endpoints
- Payment provider failures: retry with exponential backoff (3 attempts, ~1s / 2s / 4s delays), then mark transaction `failed` and notify player
- WebSocket disconnection during crash round: client auto-reconnects; server maintains bet state in Redis — no bets are lost on reconnect
- All money operations wrapped in PostgreSQL transactions — partial writes are impossible

---

## 11. Testing Strategy

- **Unit tests:** crash RNG / provably fair calculation, tax engine (rate application, rounding), wallet debit/credit logic
- **Integration tests:** payment provider webhook handlers (M-Pesa, MTN, Airtel), provider wallet API (debit/credit/rollback for slots and virtual sports)
- **Manual QA** on staging for game flows and payment flows
- No E2E automation for MVP

---

## 12. Deployment (Render)

| Service | Render Type | Tier |
|---|---|---|
| `api` | Web service | Starter (always-on) |
| `web` | Web service | Starter |
| `admin` | Web service | Starter |
| PostgreSQL | Managed PostgreSQL | Starter |
| Redis | Managed Redis | Starter |

Environment variables managed via Render's environment groups — no secrets in the repo. Separate environment groups for staging and production.

CI: GitHub Actions runs tests on every push to main before deploy.
