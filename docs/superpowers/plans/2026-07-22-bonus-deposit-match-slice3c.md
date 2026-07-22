# Bonus Deposit-Match (Slice 3c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically grant a proportional bonus on a player's first qualifying deposit, via an admin-configured deposit-match campaign, without ever risking the deposit itself.

**Architecture:** `bonus_campaigns` gains match fields + a `deposit_match` reward kind. A never-throwing `maybeGrantDepositMatch` service picks the newest qualifying active deposit-match campaign and atomically grants + records a claim, hooked post-commit at the three deposit-credit sites. Deposit-match campaigns are auto-only (excluded from manual claim/list). Admin CRUD + UI gain the reward-kind + match fields.

**Tech Stack:** Fastify + `@betting/db` (raw SQL), Zod, Vitest (API); Next.js 14 + Tailwind (admin).

## Global Constraints

- Migration `packages/db/migrations/041_deposit_match.sql` (next number 041), runs on API boot; additive/relaxing only.
- Money is integer cents. API error shape `{ error: { code, message } }`; `AppError` from `apps/api/src/lib/errors.js`.
- Deposit-match is BEST-EFFORT: `maybeGrantDepositMatch` never throws; a match failure must never roll back or fail a deposit. It runs AFTER the deposit commits, on its own pool connection.
- Eligibility (locked): account `status='active'`, no active bonus, once-per-campaign (`bonus_claims` unique), campaign criteria (if set). NO device/IP/prior-bonus abuse blocks.
- `bonus = min(floor(depositCents * match_percent / 100), max_match_cents)`; grant only if `> 0`.
- One best match: newest active in-window qualifying deposit-match campaign.
- Deposit-match campaigns are auto-only: excluded from `GET /bonuses/available` and rejected by `claimCampaignBonus` (`CAMPAIGN_UNAVAILABLE`).
- ESM `.js` extensions. No em-dashes. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Tests: `cd apps/api && npx vitest run <path>`; typecheck api/admin `npx tsc --noEmit`.
- Existing deposit/campaign/claim tests stay green.

## File Structure

**API (create):** `packages/db/migrations/041_deposit_match.sql`; `apps/api/src/services/deposit-match.service.ts` + test.
**API (modify):** `apps/api/src/services/payment.service.ts` (+ test), `apps/api/src/services/c2b.service.ts` (+ test); `apps/api/src/services/bonus-claim.service.ts`, `apps/api/src/routes/bonuses.ts`; `apps/api/src/routes/admin/campaigns.ts` (+ test).
**Admin (modify):** `apps/admin/src/components/CampaignsTab.tsx`.

---

## Task 1: Migration 041

**Files:** Create `packages/db/migrations/041_deposit_match.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE bonus_campaigns
  ADD COLUMN IF NOT EXISTS match_percent     INT,
  ADD COLUMN IF NOT EXISTS max_match_cents   BIGINT,
  ADD COLUMN IF NOT EXISTS min_deposit_cents BIGINT;

ALTER TABLE bonus_campaigns DROP CONSTRAINT IF EXISTS bonus_campaigns_type_check;
ALTER TABLE bonus_campaigns ADD CONSTRAINT bonus_campaigns_type_check
  CHECK (type IN ('welcome','custom','deposit_match'));

ALTER TABLE bonus_campaigns DROP CONSTRAINT IF EXISTS bonus_campaigns_reward_kind_check;
ALTER TABLE bonus_campaigns ADD CONSTRAINT bonus_campaigns_reward_kind_check
  CHECK (reward_kind IN ('fixed','deposit_match'));

ALTER TABLE bonus_campaigns ALTER COLUMN amount_cents DROP NOT NULL;
ALTER TABLE bonus_campaigns DROP CONSTRAINT IF EXISTS bonus_campaigns_amount_cents_check;
ALTER TABLE bonus_campaigns ADD CONSTRAINT bonus_campaigns_reward_shape_check CHECK (
  (reward_kind = 'fixed' AND amount_cents IS NOT NULL AND amount_cents > 0)
  OR
  (reward_kind = 'deposit_match' AND match_percent > 0 AND max_match_cents > 0 AND min_deposit_cents >= 0)
);
```

- [ ] **Step 2: Typecheck** — `cd apps/api && npx tsc --noEmit`.
- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/041_deposit_match.sql
git commit -m "feat(db): deposit-match campaign columns + reward-shape check

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Deposit-match auto-grant service

**Files:** Create `apps/api/src/services/deposit-match.service.ts` + `deposit-match.service.test.ts`
**Interfaces:** Produces `maybeGrantDepositMatch(playerId: string, depositAmountCents: number): Promise<void>` (never throws).

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/services/deposit-match.service.test.ts` (mock `@betting/db` pool.query + pool.connect, `./wallet.service.js` grantBonus, `./bonus-criteria.service.js` playerMatchesCriteria). Cover: qualifying deposit grants `min(floor(dep*pct/100), cap)` and inserts a claim (assert grantBonus called with the computed amount + `{source:'campaign', campaignId}`); player not active -> no grant; player with active bonus -> no grant; no candidate campaign -> no grant; criteria mismatch -> skipped; picks newest qualifying when several; a thrown pool error -> the function still RESOLVES (never rejects). Model the fixed-order pool.query mock: status SELECT, active-bonus SELECT, candidates SELECT, then the connect() client for the grant transaction.

- [ ] **Step 2: Run to verify fail** — `cd apps/api && npx vitest run src/services/deposit-match.service.test.ts` (module not found).

- [ ] **Step 3: Implement**

Create `apps/api/src/services/deposit-match.service.ts`:

```ts
import { pool } from '@betting/db'
import { grantBonus } from './wallet.service.js'
import { playerMatchesCriteria, type Criteria } from './bonus-criteria.service.js'

// Best-effort: NEVER throws. Grants a deposit-match bonus for the newest active,
// in-window deposit_match campaign the player qualifies for. Runs after a deposit
// has committed, on its own connection.
export async function maybeGrantDepositMatch(playerId: string, depositAmountCents: number): Promise<void> {
  try {
    const { rows: pl } = await pool.query<{ status: string }>(
      `SELECT status FROM players WHERE id = $1`, [playerId],
    )
    if (pl.length === 0 || pl[0].status !== 'active') return

    const { rows: active } = await pool.query(
      `SELECT 1 FROM bonus_grants WHERE player_id = $1 AND status = 'active'`, [playerId],
    )
    if (active.length > 0) return

    const { rows: camps } = await pool.query<{
      id: string; match_percent: number; max_match_cents: string; expiry_days: number; criteria: Criteria | null
    }>(
      `SELECT c.id, c.match_percent, c.max_match_cents, c.expiry_days, c.criteria
       FROM bonus_campaigns c
       WHERE c.reward_kind = 'deposit_match' AND c.status = 'active'
         AND (c.starts_at IS NULL OR c.starts_at <= NOW())
         AND (c.ends_at IS NULL OR c.ends_at >= NOW())
         AND COALESCE(c.min_deposit_cents, 0) <= $2
         AND NOT EXISTS (SELECT 1 FROM bonus_claims bc WHERE bc.campaign_id = c.id AND bc.player_id = $1)
       ORDER BY c.created_at DESC`,
      [playerId, depositAmountCents],
    )

    let chosen: (typeof camps)[number] | null = null
    for (const c of camps) {
      if (c.criteria && !(await playerMatchesCriteria(playerId, c.criteria))) continue
      chosen = c
      break
    }
    if (!chosen) return

    const bonus = Math.min(
      Math.floor((depositAmountCents * chosen.match_percent) / 100),
      Number(chosen.max_match_cents),
    )
    if (bonus <= 0) return

    const expiresAt = new Date(Date.now() + chosen.expiry_days * 24 * 60 * 60 * 1000)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { grantId } = await grantBonus(client, playerId, bonus, null, expiresAt, { source: 'campaign', campaignId: chosen.id })
      await client.query(
        `INSERT INTO bonus_claims (campaign_id, player_id, grant_id) VALUES ($1, $2, $3)`,
        [chosen.id, playerId, grantId],
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      // 23505 = already matched (race with the one-active/one-per-campaign guards)
      if ((err as { code?: string }).code !== '23505') throw err
    } finally {
      client.release()
    }
  } catch (err) {
    // Best-effort: a deposit must never fail because of the bonus match.
    console.warn('[deposit-match] skipped:', (err as Error)?.message)
  }
}
```

- [ ] **Step 4: Run tests + tsc** — `cd apps/api && npx vitest run src/services/deposit-match.service.test.ts && npx tsc --noEmit` (PASS).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/deposit-match.service.ts apps/api/src/services/deposit-match.service.test.ts
git commit -m "feat(api): deposit-match auto-grant service (best-effort)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Hook the match into the deposit sites

**Files:** Modify `apps/api/src/services/payment.service.ts` (+ `payment.service.test.ts`), `apps/api/src/services/c2b.service.ts` (+ `c2b.service.test.ts`)
**Interfaces:** Consumes `maybeGrantDepositMatch`.

- [ ] **Step 1: Write failing tests**

In `payment.service.test.ts` add: a successful `confirmDeposit` calls `maybeGrantDepositMatch(playerId, amount)`; a declined/failed one does not (mock `./deposit-match.service.js`). In `c2b.service.test.ts` add: a credited `recordC2bPayment` (player matched) calls it; an unmapped (no player) or duplicate payment does not. Read both test files first to match their existing mock setup and add `vi.mock('./deposit-match.service.js', () => ({ maybeGrantDepositMatch: vi.fn() }))`.

- [ ] **Step 2: Run to verify fail**.

- [ ] **Step 3: Implement `confirmDeposit` hook**

In `apps/api/src/services/payment.service.ts`:
- Import: `import { maybeGrantDepositMatch } from './deposit-match.service.js'`
- In `confirmDeposit`, capture the credited deposit and fire the match AFTER the transaction fully completes. Declare before the `try`: `let credited: { playerId: string; amount: number } | null = null`. In the `if (success) { ... }` branch (right after `creditDeposit`), set `credited = { playerId: pt.player_id, amount: Number(pt.amount) }`. After the `try/catch/finally` block (post-`client.release()`), add:

```ts
  if (credited) await maybeGrantDepositMatch(credited.playerId, credited.amount)
```
(The service never throws, so this is safe; it runs only when a deposit was actually credited and the transaction committed.)

- [ ] **Step 4: Implement the c2b hooks**

In `apps/api/src/services/c2b.service.ts`:
- Import `maybeGrantDepositMatch`.
- `recordC2bPayment`: in the player-matched branch, immediately after `await client.query('COMMIT')` and before `return { status: 'credited', playerId }`, add `await maybeGrantDepositMatch(playerId, amount)`. (Do NOT add it to the unmapped/duplicate branches.)
- `repostC2bPayment`: after its credit COMMIT, call `await maybeGrantDepositMatch(playerId, Number(rows[0].amount))` (use the resolved player id + reposted amount). Read the function to bind the correct variables.
(Both are post-commit; the service never throws.)

- [ ] **Step 5: Run tests + full suite + tsc** — `cd apps/api && npx vitest run src/services/payment.service.test.ts src/services/c2b.service.test.ts && npx vitest run && npx tsc --noEmit` (PASS).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/payment.service.ts apps/api/src/services/payment.service.test.ts apps/api/src/services/c2b.service.ts apps/api/src/services/c2b.service.test.ts
git commit -m "feat(api): grant deposit-match after successful deposits

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Auto-only guard (exclude from claim + list)

**Files:** Modify `apps/api/src/services/bonus-claim.service.ts` (+ test), `apps/api/src/routes/bonuses.ts` (+ test)

- [ ] **Step 1: Write failing tests**

In `bonus-claim.service.test.ts`: claiming a `reward_kind='deposit_match'` campaign -> `422 CAMPAIGN_UNAVAILABLE` and no grant. In `bonuses.test.ts` `GET /bonuses/available`: a `deposit_match` campaign row is not returned. Add `reward_kind` to the relevant mock campaign rows.

- [ ] **Step 2: Run to verify fail**.

- [ ] **Step 3: Implement**

- In `apps/api/src/services/bonus-claim.service.ts`: the campaign SELECT already reads several columns; add `reward_kind` to it. Right after the active/window check (and before the code gate is fine), add:

```ts
  if (c.reward_kind === 'deposit_match') {
    // Deposit-match bonuses are granted automatically on a qualifying deposit.
    throw new AppError('CAMPAIGN_UNAVAILABLE', 'This bonus is not available.', 422)
  }
```
(Update the SELECT's row type to include `reward_kind: string`.)

- In `apps/api/src/routes/bonuses.ts` `GET /bonuses/available`, add `AND c.reward_kind = 'fixed'` to the WHERE (deposit-match campaigns never appear in the claimable list).

- [ ] **Step 4: Run tests + full suite + tsc** — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/bonus-claim.service.ts apps/api/src/services/bonus-claim.service.test.ts apps/api/src/routes/bonuses.ts apps/api/src/routes/bonuses.test.ts
git commit -m "feat(api): deposit-match campaigns are auto-only (no manual claim/list)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Admin campaign routes (reward kind + match fields)

**Files:** Modify `apps/api/src/routes/admin/campaigns.ts` (+ `campaigns.test.ts`)

- [ ] **Step 1: Write failing tests**

Add: create a `deposit_match` campaign (rewardKind + matchPercent/maxMatchCents/minDepositCents) returns id; create deposit_match missing match fields -> 400; existing fixed create still works. Read the test file to match mock patterns.

- [ ] **Step 2: Run to verify fail**.

- [ ] **Step 3: Implement**

In `apps/api/src/routes/admin/campaigns.ts`:
- Extend `upsertBody`:

```ts
const upsertBody = z.object({
  key: z.string().min(2).max(40).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers, underscores.'),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  type: z.enum(['welcome', 'custom', 'deposit_match']),
  rewardKind: z.enum(['fixed', 'deposit_match']).default('fixed'),
  amountCents: z.number().int().positive().optional(),
  matchPercent: z.number().int().min(1).max(100).optional(),
  maxMatchCents: z.number().int().positive().optional(),
  minDepositCents: z.number().int().min(0).optional(),
  expiryDays: z.number().int().min(1).max(365).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  code: z.string().trim().min(2).max(40).optional(),
  criteria: criteriaSchema.optional(),
}).refine(
  d => d.rewardKind === 'deposit_match'
    ? (d.matchPercent != null && d.maxMatchCents != null)
    : (d.amountCents != null && d.amountCents > 0),
  { message: 'Provide an amount for a fixed bonus, or match percent + cap for a deposit match.' },
)
```
- CREATE: add `reward_kind, match_percent, max_match_cents, min_deposit_cents` to the INSERT columns/params (`d.rewardKind`, `d.matchPercent ?? null`, `d.maxMatchCents ?? null`, `d.minDepositCents ?? 0`; and for a deposit_match, pass `amount_cents = null`). Keep code/criteria as-is.
- EDIT (partial): COALESCE the four new columns in too.
- List SELECT: include `reward_kind, match_percent, max_match_cents, min_deposit_cents`.
- Keep the existing `23505` constraint mapping. A `reward_shape_check` violation (23514) can surface as the generic 400 via the existing validation, but add a friendly catch if convenient:

```ts
      if ((err as { code?: string }).code === '23514') return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Campaign reward fields are incomplete.' } })
```

- [ ] **Step 4: Run tests + full suite + tsc** — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/campaigns.ts apps/api/src/routes/admin/campaigns.test.ts
git commit -m "feat(api): admin deposit-match campaign fields

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Admin CampaignsTab — reward kind + match fields

**Files:** Modify `apps/admin/src/components/CampaignsTab.tsx`

- [ ] **Step 1: Add the reward-kind toggle + match fields**

Read `CampaignsTab.tsx`. Add a **Reward kind** select (Fixed amount / Deposit match) to the create/edit form. When Fixed: show the existing amount (KES) field. When Deposit match: show Match % (1-100), Max match (KES -> cents), Min deposit (KES -> cents). Build the payload per kind: fixed sends `rewardKind:'fixed'` + `amountCents`; deposit_match sends `rewardKind:'deposit_match'`, `type:'deposit_match'`, `matchPercent`, `maxMatchCents`, `minDepositCents` (omit `amountCents`). The table shows a reward summary per row: fixed -> `kes(amount_cents)`; deposit_match -> `${match_percent}% up to ${kes(max_match_cents)}, min ${kes(min_deposit_cents)}`. Keep `@/lib/api` {data,error}, kes(), no em-dashes. Surface the validation error message.

- [ ] **Step 2: Typecheck** — `cd apps/admin && npx tsc --noEmit` (clean).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/components/CampaignsTab.tsx
git commit -m "feat(admin): deposit-match reward kind + fields in Campaigns tab

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full verification + deploy

- [ ] **Step 1:** `cd apps/api && npx vitest run && npx tsc --noEmit` (all green).
- [ ] **Step 2:** `cd apps/admin && npx tsc --noEmit` and `cd apps/web && npx tsc --noEmit` (clean).
- [ ] **Step 3:** Push branch; deploy API (`srv-d7eb279o3t8c73ebvvdg`, migration 041) then Admin (`srv-d7ee004vikkc73enkl40`). (Web unchanged; redeploy optional.) Capture each deploy id (`grep -oE '"id":"dep-[^"]*"'`), poll to `live`.
- [ ] **Step 4:** Prod smoke: `/admin/campaigns` (401). Confirm log shows `applied 041_deposit_match.sql`.
- [ ] **Step 5:** Manual: admin create a deposit-match campaign (50% up to KES 500, min KES 100, active). A test player deposits KES 200 -> bonus balance rises by KES 100; a second deposit -> no second match (once per campaign); a player holding an active bonus -> deposit credits but no match.

---

## Self-Review Notes

- **Spec coverage:** match columns + reward-shape check (Task 1); best-effort auto-grant engine (Task 2); deposit-site hooks (Task 3); auto-only claim/list guard (Task 4); admin routes reward-kind + match fields (Task 5); admin UI (Task 6); verify+deploy (Task 7). All spec sections map to a task.
- **Type consistency:** `maybeGrantDepositMatch(playerId, depositAmountCents)` consistent Tasks 2-3; `rewardKind`/`matchPercent`/`maxMatchCents`/`minDepositCents` consistent Tasks 5-6; `grantBonus(..., {source:'campaign', campaignId})` reused unchanged.
- **Safety:** the match never throws and runs post-commit, so a deposit can never fail because of it; eligibility skips (never errors) when a player is non-active / already-bonused / already-matched; deposit-match campaigns can't be manually claimed or listed.
