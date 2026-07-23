# Scratch-card Fund Source Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist scratch-card funding source + net credited, and show net (not gross) for bonus-funded cards in history, bringing scratch to parity with crash/dice. Plus reset the deposit-bonus toast ref on logout.

**Architecture:** Additive migration on `scratch_cards`; the scratch service records fund source + grant + net; the unified history route reports net for bonus cards; the web scratch history maps net. No game-math or provable-fair change.

**Tech Stack:** Fastify + `@betting/db` (raw SQL), Vitest (API); Next.js 14 (web).

## Global Constraints

- Money is integer cents. No change to scratch RTP, stakes, multipliers, or seed logic.
- `buyScratchCard` already: `debitBonusForBet`/`settleBonusWin` (bonus, net-to-cash, cap) or `debitForBet`/`creditWinnings` (cash). Do NOT change that math.
- API error shape `{ error: { code, message } }`. ESM `.js` imports. No em-dashes.
- Commit trailer (verbatim last line): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Tests: API `cd apps/api && npx vitest run <path>` + `npx tsc --noEmit`; web `npx tsc --noEmit`.
- Migration is next number 042. No backfill of legacy rows (documented in spec).

## File Structure

**API (create):** `packages/db/migrations/042_scratch_fund_source.sql`.
**API (modify):** `apps/api/src/services/scratch.service.ts` (+ `scratch.service.test.ts`), `apps/api/src/routes/games/history.ts` (+ test if one exists).
**Web (modify):** `apps/web/src/app/(player)/games/wingu-scratch/page.tsx`, `apps/web/src/app/(player)/layout.tsx`.

---

## Task 1: Migration 042

**Files:** Create `packages/db/migrations/042_scratch_fund_source.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE scratch_cards
  ADD COLUMN IF NOT EXISTS fund_source        VARCHAR(10) NOT NULL DEFAULT 'cash'
    CHECK (fund_source IN ('cash','bonus')),
  ADD COLUMN IF NOT EXISTS bonus_grant_id     UUID REFERENCES bonus_grants(id),
  ADD COLUMN IF NOT EXISTS net_credited_cents BIGINT;
```

- [ ] **Step 2: Typecheck** — `cd apps/api && npx tsc --noEmit`.
- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/042_scratch_fund_source.sql
git commit -m "feat(db): scratch_cards fund_source, bonus_grant_id, net_credited_cents

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Persist fund source + net in the scratch service

**Files:** Modify `apps/api/src/services/scratch.service.ts` (+ `scratch.service.test.ts`)

- [ ] **Step 1: Write failing tests**

In `scratch.service.test.ts` (read it first to match the pool/wallet mock pattern) add/extend:
- A bonus buy with a winning grid: the INSERT is called with `fund_source='bonus'` and the `bonus_grant_id` from `debitBonusForBet`, and a later UPDATE sets `net_credited_cents` to the net returned by `settleBonusWin` (assert the UPDATE param equals the mocked net, which is < gross when capped).
- A cash buy with a winning grid: INSERT `fund_source='cash'`, `bonus_grant_id` null; `net_credited_cents` = `prizeCents`.
- A losing card (prize 0): `net_credited_cents` = 0.
- `getScratchHistory` returns `fundSource` and `netCreditedCents` (COALESCE net, prize) per row.

- [ ] **Step 2: Run to verify fail**.

- [ ] **Step 3: Implement**

In `buyScratchCard`:
- Change the INSERT to record the funding columns:

```ts
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO scratch_cards (player_id, wallet_id, stake_cents, grid, prize_cents, status, fund_source, bonus_grant_id)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7) RETURNING id`,
      [playerId, walletId, stakeCents, grid, prizeCents, fundSource, bonusGrantId],
    )
    const cardId = rows[0].id
```
- After the win-settlement block computes `netCredited` (it is 0 when no prize, `prizeCents` for cash, and the bonus net for bonus), persist it before COMMIT:

```ts
    await client.query(
      `UPDATE scratch_cards SET net_credited_cents = $1 WHERE id = $2`,
      [netCredited, cardId],
    )
```
(Place it after the `if (prizeCents > 0) { ... }` block and before `await client.query('COMMIT')`.)

In `getScratchHistory`:
- Add `fund_source` and `net_credited_cents` to the SELECT and to the row type; map:
  `fundSource: r.fund_source as 'cash' | 'bonus'` and
  `netCreditedCents: Number(r.net_credited_cents ?? r.prize_cents)` (keep `prizeCents` as-is). Update the function's return type accordingly.

- [ ] **Step 4: Run tests + full suite + tsc** — `cd apps/api && npx vitest run src/services/scratch.service.test.ts && npx vitest run && npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/scratch.service.ts apps/api/src/services/scratch.service.test.ts
git commit -m "feat(api): record scratch fund source + net credited

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Unified history reports net for bonus scratch

**Files:** Modify `apps/api/src/routes/games/history.ts` (+ its test if one exists)

- [ ] **Step 1: Write/adjust test**

If a history route test exists, add a case: a bonus scratch card (net < gross) reports `payout` = net in `/games/history/all`. If no test file exists, add a minimal one building the server and asserting the scratch payout equals net when `net_credited_cents` is set (mock the pool query result rows). Keep scope to this assertion.

- [ ] **Step 2: Implement**

In `/games/history/all`, make every UNION branch select a uniform `fund_source` column and use net for scratch payout:

```ts
      `SELECT id::text AS id, game_type::text AS game, gross_stake AS stake,
              cashout_multiplier AS multiplier, COALESCE(winnings, 0) AS payout,
              status::text AS status, created_at, fund_source
         FROM bets WHERE player_id = $1
       UNION ALL
       SELECT id::text, 'scratch', stake_cents, NULL::numeric,
              COALESCE(net_credited_cents, prize_cents),
              CASE WHEN prize_cents > 0 THEN 'won' ELSE 'lost' END, created_at, fund_source
         FROM scratch_cards WHERE player_id = $1
       UNION ALL
       SELECT id::text, 'lotto', ticket_price, NULL::numeric,
              COALESCE(prize_cents, 0), status::text, created_at, 'cash'::varchar
         FROM lottery_tickets WHERE player_id = $1
       ORDER BY created_at DESC
       LIMIT 50`
```
Add `fundSource: r.fund_source` to the normalized output object. (Confirm `bets` has a `fund_source` column - it was added in migration 037; if its type differs from varchar, cast consistently so the UNION column types match, e.g. `fund_source::varchar` in all three branches.)

- [ ] **Step 3: Run tests + full suite + tsc** — PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/games/history.ts
git commit -m "fix(api): scratch history reports net credited for bonus cards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Web — scratch history net + toast logout reset

**Files:** Modify `apps/web/src/app/(player)/games/wingu-scratch/page.tsx`, `apps/web/src/app/(player)/layout.tsx`

- [ ] **Step 1: Scratch history maps net.** In the scratch page, the `HistoryCard` interface (currently `{ ... prizeCents }`) gains `fundSource?: 'cash' | 'bonus'` and `netCreditedCents?: number` (the `/games/scratch/history` response now returns them). In `cardToEntry`, set `payout: card.netCreditedCents ?? card.prizeCents` (so bonus cards show net, matching the live post-buy display). Leave the `status` logic (`prizeCents > 0 ? 'won' : 'lost'`) unchanged. Read the file first to match exact names.

- [ ] **Step 2: Toast logout reset.** In `layout.tsx`, reset `prevBonusRef.current = null` when the player logs out / profile clears, so a re-login re-seeds without a spurious "Bonus added" toast. Read the file: in the detection effect add an early branch `if (profile === null) { prevBonusRef.current = null; return }` (replacing the current bare `if (profile === null) return`), OR reset it in the logout handler. The first is simplest and correct.

- [ ] **Step 3: Typecheck** — `cd apps/web && npx tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(player)/games/wingu-scratch/page.tsx" "apps/web/src/app/(player)/layout.tsx"
git commit -m "fix(web): scratch history shows net for bonus cards; reset bonus toast on logout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Verify + deploy

- [ ] **Step 1:** `cd apps/api && npx vitest run && npx tsc --noEmit` (green).
- [ ] **Step 2:** `cd apps/web && npx tsc --noEmit` and `cd apps/admin && npx tsc --noEmit` (clean).
- [ ] **Step 3:** Merge branch to master; push. Deploy API (`srv-d7eb279o3t8c73ebvvdg`, migration 042) then Web (`srv-d7edvs57vvec73ep0shg`). Capture deploy ids, poll to `live`.
- [ ] **Step 4:** Prod smoke: API `/health` 200; `/games/scratch/history` 401; web scratch + `/history` pages load 200. Confirm log shows `apply 042_scratch_fund_source.sql` (or API boots healthy, which requires migrations to pass).

---

## Self-Review Notes

- **Spec coverage:** migration (Task 1); service persist fund_source/grant/net + history fields (Task 2); unified history net payout (Task 3); web scratch net display + toast logout reset (Task 4); verify+deploy (Task 5). All spec items mapped.
- **Type consistency:** `net_credited_cents` written in Task 2, read in Task 2 (getScratchHistory) and Task 3 (history/all COALESCE) and Task 4 (web netCreditedCents); `fund_source` written Task 2, exposed Task 2/3, consumed Task 4. UNION branch column counts kept equal (8 columns each after adding fund_source).
- **Safety:** additive migration; no change to money math/cap/RTP/seed; legacy rows fall back to gross==net for cash; no backfill (documented).
