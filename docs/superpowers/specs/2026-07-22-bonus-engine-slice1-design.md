# Bonus Engine (Slice 1) — design

**Date:** 2026-07-22
**Status:** Approved for planning
**Part of:** a larger bonus/campaign system. This is Slice 1 of 3.

## Context

The player wallet already has an unused `bonus_balance` column, and `006_games.sql`
created an unused placeholder `bonus_grants` table built around a
wagering-requirement model we are **not** using. Bonuses are otherwise
unimplemented: every bet debits/credits real cash (`wallets.balance`) via
`wallet.service.ts`, and every in-house game funds bets through `debitForBet`.

This slice builds the bonus **wallet + wagering engine** end-to-end, exercised by
a single grant path (admin manual grant) and a player "bet with bonus" toggle. It
proves the hard mechanics (dual-wallet wagering, net-to-cash, per-bet cap, lotto
block, one-active-bonus, void/refund) before later slices add self-service claims,
campaigns, and abuse prevention.

## Decisions (locked with the user)

- **Separate wallets:** a wager is entirely cash **or** entirely bonus, never
  mixed. The player picks the fund source per bet.
- **Winnings:** on a winning bonus bet, `net = payout - bonusStake` (the profit).
  Only `net` is credited, to **withdrawable cash**. The free stake is not
  returned. No wagering/rollover requirement.
- **Cap:** **per-bet** — a single bonus bet credits at most `bonus_max_win`
  (default KES 10,000) to cash. Anything above is forfeited on that bet.
- **Lotto:** rejects bonus-funded bets. External/provider games also excluded in
  this slice.
- **One per customer:** at most **one active bonus at a time** (a new grant is
  blocked while one is active). One-claim-per-campaign-per-identity is a later
  slice; here the guard is simply "no active bonus already."
- **Grant source (this slice):** admin manual grant only.
- **Eligible games:** crash, mines, dice, scratch.

## Data model — migration `037_bonus_engine.sql`

```sql
-- Replace the unused placeholder grants table (wagering-requirement model we do
-- not use). Safe: no rows in production, no FKs reference it.
DROP TABLE IF EXISTS bonus_grants;

CREATE TABLE bonus_grants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID   NOT NULL REFERENCES players(id),
  wallet_id      UUID   NOT NULL REFERENCES wallets(id),
  source         VARCHAR(20) NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('manual')),      -- widened in later slices
  amount_granted BIGINT NOT NULL CHECK (amount_granted > 0),
  remaining      BIGINT NOT NULL CHECK (remaining >= 0),
  status         VARCHAR(20) NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','exhausted','expired','revoked')),
  granted_by     UUID   REFERENCES admin_users(id),
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bonus_grants_player_id ON bonus_grants(player_id);
-- At most one active bonus per player (enforces one-at-a-time).
CREATE UNIQUE INDEX uq_bonus_grants_one_active
  ON bonus_grants(player_id) WHERE status = 'active';

-- Bets learn which wallet funded them.
ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS fund_source VARCHAR(10) NOT NULL DEFAULT 'cash'
    CHECK (fund_source IN ('cash','bonus')),
  ADD COLUMN IF NOT EXISTS bonus_grant_id UUID REFERENCES bonus_grants(id);

-- Ledger types for the bonus lifecycle.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN (
    'deposit','withdrawal','bet_placed','bet_won','bet_refunded',
    'bonus_credit','bonus_wager','wager_tax','withdrawal_tax','demo_topup',
    'bonus_granted','bonus_bet','bonus_won','bonus_refunded','bonus_forfeited'
  ));
```

Config lives in `game_settings` (existing key/value JSONB store), read via the
settings service with defaults so the migration seeds nothing:
- `bonus_max_win_cents` (default `1000000` = KES 10,000)
- `bonus_default_expiry_days` (default `30`)

`wallets.bonus_balance` (existing) is the live remaining balance of the single
active grant. `bonus_grants.remaining` mirrors it and is the per-grant source of
truth for lifecycle/audit; the two move together inside one transaction.

## Wallet mechanics — new helpers in `apps/api/src/services/wallet.service.ts`

All take a `PoolClient` and run inside the caller's transaction, mirroring the
existing helpers.

- `debitBonusForBet(client, playerId, grantId, stake, metadata)` — `SELECT ...
  FOR UPDATE` the wallet; require `bonus_balance >= stake` (else
  `INSUFFICIENT_BONUS`); `bonus_balance -= stake` and `bonus_grants.remaining -=
  stake`; write a `bonus_bet` transaction. No `locked_balance` use — the stake
  leaves the bonus wallet outright (it is never returned on a normal loss, so
  there is nothing to lock). Returns `{ transactionId, walletId }`.
- `settleBonusWin(client, playerId, grantId, payout, stake, betId, maxWinCents)`
  — `net = min(payout - stake, maxWinCents)`; if `net > 0`, `balance += net`
  (cash) and write a `bonus_won` transaction. Returns `{ net }`.
- `refundBonusBet(client, playerId, grantId, stake, metadata)` — return `stake`
  to `bonus_balance` and `bonus_grants.remaining`; write `bonus_refunded`. Used
  when an in-flight round is voided.
- `grantBonus(client, playerId, amount, grantedBy, expiresAt)` — insert an
  `active` `bonus_grants` row (source `manual`), `bonus_balance += amount`, write
  `bonus_granted`. The partial unique index makes a second active grant fail;
  the admin route pre-checks and returns a friendly error.
- `forfeitBonus(client, grantId, reason)` — set `remaining = 0`, deduct the
  remaining from `bonus_balance`, mark the grant `expired`/`revoked`, write
  `bonus_forfeited`.

Bonus bets carry `wager_tax = 0` and `effective_stake = stake` (promotional; no
tax), consistent with how the in-house games already pass tax = 0.

## Bet placement — `fundSource` across the four games

Each game route body gains `fundSource: z.enum(['cash','bonus']).default('cash')`,
threaded into the service. Crash bet entry runs through `crash-socket.ts`, so its
bet event carries `fundSource` too.

Service behavior when `fundSource === 'bonus'`:
1. Resolve the player's active grant (`SELECT ... WHERE player_id AND status =
   'active' FOR UPDATE`); none → `NO_ACTIVE_BONUS` (422). Expired (past
   `expires_at`) → lazily `forfeitBonus` then `NO_ACTIVE_BONUS`.
2. Debit via `debitBonusForBet` instead of `debitForBet`. Record `fund_source =
   'bonus'` and `bonus_grant_id` on the `bets` row.
3. **Settlement branches on the bet's `fund_source`:**
   - Instant games (dice, scratch): on win, `settleBonusWin` (net capped to
     cash) instead of `creditWinnings`.
   - In-flight games (crash, mines): the settle/cashout/mine-hit/void paths read
     the bet's `fund_source`. Bonus bets did **not** lock, so those paths must
     **skip** the `locked_balance` decrement for bonus bets, use `settleBonusWin`
     on a win, and `refundBonusBet` on a void/refund. Cash bets are unchanged.

Lotto (`lottery.service.ts`) and provider/external games reject `fundSource =
'bonus'` with `BONUS_NOT_ALLOWED` (422).

Guardrails in the bonus debit path: `stake <= bonus_balance`; stake within the
game's existing min/max; the grant is active and unexpired.

## Admin — manual grant + listing

New RBAC permissions added to the **code catalog** (`apps/api/src/lib/
permissions.ts`), so super_admin gets them automatically (wildcard) and other
roles can be granted them in the Staff UI:
- `bonuses.view`, `bonuses.grant`

Routes (`apps/api/src/routes/admin/bonuses.ts`, registered in `server.ts`):
- `POST /admin/bonuses/grant` — `[authenticateAdmin, requirePermission('bonuses.grant')]`.
  Body `{ playerId, amountCents, expiresInDays? }`. Rejects if the player already
  has an active grant (`ACTIVE_BONUS_EXISTS`, 409) or player not found (404).
  `expiresAt = now + (expiresInDays ?? bonus_default_expiry_days)`. Runs
  `grantBonus` in a transaction; audits to `admin_audit_log` (entity `'bonus'`).
- `GET /admin/bonuses` — `[authenticateAdmin, requirePermission('bonuses.view')]`.
  Lists recent grants with player name/phone, amount, remaining, status, expiry,
  granted-by.

Admin UI: a new **Bonuses** tab (permission-driven via the existing
`TAB_PERMISSION` map, key `bonuses.view`): a grants table + a "Grant bonus" form
(player lookup by phone/id, amount, expiry days).

## Player UI

- `getWalletBalance` already returns `bonusBalance`; surface it in the wallet/
  header where the cash balance shows.
- The shared stake box gets a **"Use bonus" toggle**, shown only when
  `bonusBalance > 0`, which sets `fundSource: 'bonus'` on the bet request. Copy
  makes clear bonus and cash cannot be mixed and that Lotto is excluded. When the
  toggle is on, the quick-stake amounts are bounded by the bonus balance.
- Lotto's stake box does not show the toggle.

## Testing

- `wallet.service` unit tests: `debitBonusForBet` (happy + insufficient),
  `settleBonusWin` (net = payout - stake; capped at `maxWin`; net <= 0 credits
  nothing), `refundBonusBet`, `grantBonus` (second active grant blocked by the
  unique index), `forfeitBonus`.
- Per-game tests (dice, scratch, mines, crash): a bonus-funded win credits `net`
  (capped) to cash and does not return the stake; a bonus loss returns nothing; a
  crash/mines void refunds the bonus stake and does not touch `locked_balance`.
- `lottery.service`: bonus bet rejected `BONUS_NOT_ALLOWED`.
- Admin route tests: grant happy path; second active grant → 409; permission gate.
- Existing cash-bet tests must remain green (fund_source defaults to 'cash').

## Out of scope (later slices)

- Self-service claims: welcome bonus, promo code, deposit match, custom campaigns,
  target lists (Slice 3).
- Eligibility / abuse prevention: IP, device, household, shared-network dedup and
  the data capture behind it (Slice 2). This slice enforces only one-active-bonus.
- Admin-configurable cap/expiry editing UI (defaults are configurable via the
  settings store; a dedicated editor comes with the campaign UI).
- Bonus support for external/provider games.

## Rollout

- Migration runs on API boot. `fund_source` defaults to `'cash'`, so existing
  bets and cash flows are unaffected.
- Deploy order: API, then Admin, then Web. Player web app changes are additive.
- Verify: API tsc + full vitest; admin/web tsc; prod smoke of `/admin/bonuses`
  (401 unauth) and a manual grant → bet-with-bonus → net-to-cash walkthrough.
