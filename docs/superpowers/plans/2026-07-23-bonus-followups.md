# Bonus Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the accumulated bonus follow-ups: correctness/security hardening, one product gap (clearable code/criteria), two UX fixes, and two test backfills.

**Architecture:** Small independent changes across API (Fastify + raw SQL), the player web app (Next.js), and admin tests. No migration. Each task is self-contained and independently reviewable.

**Tech Stack:** Fastify + `@betting/db` (raw SQL pg), Zod, `@fastify/rate-limit`, Vitest (API); Next.js 14 + Tailwind (web).

## Global Constraints

- Money/claim/deposit paths must never regress: existing bonus, claim, deposit, and eligibility tests stay green.
- API error shape `{ error: { code, message } }`; `AppError` from `apps/api/src/lib/errors.js`. Friendly, user-safe messages; never leak abuse reasons or PII to players.
- ESM `.js` import extensions. No em-dashes anywhere.
- Money is integer cents.
- Commit trailer (verbatim last line of each commit body): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Test/typecheck: API `cd apps/api && npx vitest run <path>` + `npx tsc --noEmit`; web/admin `npx tsc --noEmit`.
- No migration in this batch. Scratch-card `fund_source` is OUT of scope.

## File Structure

**API (modify):** `apps/api/src/services/deposit-match.service.ts` (+ test), `apps/api/src/routes/bonuses.ts` (+ test), `apps/api/src/services/bonus-criteria.service.ts` (+ test), `apps/api/src/services/bonus-eligibility.service.ts` (+ test), `apps/api/src/services/bonus-claim.service.ts`, `apps/api/src/routes/admin/campaigns.ts` (+ test).
**Web (modify):** `apps/web/src/app/(player)/rewards/page.tsx`, `apps/web/src/app/(player)/layout.tsx`.

---

## Task 1: deposit-match connection release on error

**Files:** Modify `apps/api/src/services/deposit-match.service.ts` (+ `deposit-match.service.test.ts`)

- [ ] **Step 1: Update the grant transaction block.** Replace the `try/catch/finally` around the grant transaction so the client is released on both paths and destroyed on a failed ROLLBACK:

```ts
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { grantId } = await grantBonus(client, playerId, bonus, null, expiresAt, { source: 'campaign', campaignId: chosen.id })
      await client.query(
        `INSERT INTO bonus_claims (campaign_id, player_id, grant_id) VALUES ($1, $2, $3)`,
        [chosen.id, playerId, grantId],
      )
      await client.query('COMMIT')
      client.release()
    } catch (err) {
      try {
        await client.query('ROLLBACK')
        client.release()
      } catch (rollbackErr) {
        // ROLLBACK failed: the connection may be poisoned. Destroy it (release
        // with an error) instead of returning it to the pool.
        client.release(rollbackErr as Error)
      }
      // 23505 = already matched (race with the one-active/one-per-campaign guards)
      if ((err as { code?: string }).code !== '23505') throw err
    }
```
(The `finally` is removed; release now happens in every path exactly once. The outer never-throws wrapper still catches the rethrown non-23505 error.)

- [ ] **Step 2: Confirm tests still pass / adjust.** Run `cd apps/api && npx vitest run src/services/deposit-match.service.test.ts`. The existing "rolls back, releases, and swallows quietly on a non-23505 error" test should still pass (ROLLBACK + release still called). The "connect() rejects" test is unaffected. If a test asserted `release` called with no args exactly, relax it to just assert `release` was called (order-independent). Do not weaken the never-throws assertions.

- [ ] **Step 3: Full run + tsc** — `npx vitest run && npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/deposit-match.service.ts apps/api/src/services/deposit-match.service.test.ts
git commit -m "fix(api): destroy poisoned connection on deposit-match rollback failure

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Rate-limit `/bonuses/claim`

**Files:** Modify `apps/api/src/routes/bonuses.ts` (+ `bonuses.test.ts`)

- [ ] **Step 1: Add per-route rate limit.** Change the claim route registration to add a `config.rateLimit`:

```ts
  app.post('/bonuses/claim', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
```
(The app registers `@fastify/rate-limit` with `global:false` in `server.ts`, so per-route `config.rateLimit` activates it. The friendly `TOO_MANY_REQUESTS` body is provided by the global `errorResponseBuilder`.)

- [ ] **Step 2: Test.** Read `apps/api/src/routes/bonuses.test.ts` and how it builds the app (whether it uses the full `buildServer` from `server.ts` or a bare Fastify). 
  - If the harness registers `@fastify/rate-limit`, add a test: 6 rapid POSTs to `/bonuses/claim` from the same client -> the 6th returns `429 TOO_MANY_REQUESTS`.
  - If the harness does NOT register rate-limit (bare app), instead assert the route options carry `config.rateLimit.max === 5` (inspect the registered route), and note in the report that a full-server 429 test is deferred. Do not fabricate a passing 429 test against an app without the plugin.

- [ ] **Step 3: Full run + tsc** — PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/bonuses.ts apps/api/src/routes/bonuses.test.ts
git commit -m "feat(api): rate-limit /bonuses/claim (5/min)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Criteria excludes non-active players

**Files:** Modify `apps/api/src/services/bonus-criteria.service.ts` (+ `bonus-criteria.service.test.ts`)

- [ ] **Step 1: Add base status condition.** In `buildCriteria`, always include `pl.status = 'active'` as the first condition of the WHERE fragment (so an empty criteria yields `pl.status = 'active'` instead of `TRUE`). Read the function first; keep the existing parameterization helper and just seed the conditions array with the literal `pl.status = 'active'` (no param needed). All other conditions append after it, joined with ` AND `.

- [ ] **Step 2: Update tests.** In `bonus-criteria.service.test.ts`:
  - The "empty criteria" case now produces `pl.status = 'active'` (not `TRUE`); update that assertion.
  - `playerMatchesCriteria` for empty criteria returns true for an ACTIVE player and false for a non-active one; add/adjust a test.
  - `countMatchingPlayers` with no criteria counts active players only; adjust.
  - Each field's fragment now sits AFTER `pl.status = 'active' AND`; update fragment assertions accordingly.

- [ ] **Step 3: Full run + tsc** — Existing `/bonuses/available` and claim tests must stay green (active players unaffected).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/bonus-criteria.service.ts apps/api/src/services/bonus-criteria.service.test.ts
git commit -m "fix(api): bonus criteria count/target active players only

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Hide claimable list when player is abuse-blocked (+ eligibility test)

**Files:** Modify `apps/api/src/services/bonus-eligibility.service.ts` (+ `bonus-eligibility.service.test.ts`), `apps/api/src/routes/bonuses.ts` (+ `bonuses.test.ts`), `apps/api/src/services/bonus-claim.service.ts`
**Interfaces:** Produces `isBonusBlocked(flags: EligibilityFlag[]): boolean` (single source of truth for the hard-block rule).

- [ ] **Step 1: Extract the block rule.** In `apps/api/src/services/bonus-eligibility.service.ts`, add and export:

```ts
const HARD_BLOCK_TYPES = new Set<FlagType>(['prior_bonus', 'device_bonus', 'ip_bonus'])

// A hard block means no self-service bonus may be claimed by this player.
export function isBonusBlocked(flags: EligibilityFlag[]): boolean {
  return flags.some(f => HARD_BLOCK_TYPES.has(f.type) || (f.type === 'ip_velocity' && f.severity === 'block'))
}
```

- [ ] **Step 2: Reuse it in the claim flow.** In `apps/api/src/services/bonus-claim.service.ts`, replace the local `BLOCKING_TYPES` set + inline `flags.find(...)` block check with `isBonusBlocked(flags)` (import it). Behavior is identical; this removes the duplicated rule.

- [ ] **Step 3: Hide when blocked in the list route.** In `apps/api/src/routes/bonuses.ts` `GET /bonuses/available`, after auth and before returning, evaluate once and short-circuit:

```ts
    const { flags } = await evaluateBonusEligibility(req.playerId)
    if (isBonusBlocked(flags)) return reply.send({ campaigns: [] })
```
(Import `evaluateBonusEligibility, isBonusBlocked` from `../services/bonus-eligibility.service.js`. Place this before the campaign query to avoid needless work.)

- [ ] **Step 4: Tests.**
  - `bonuses.test.ts`: a player whose eligibility returns a blocking flag -> `/bonuses/available` returns `{ campaigns: [] }` (mock `evaluateBonusEligibility`). A non-blocked player still gets campaigns (existing tests; ensure the eligibility mock returns no blocking flags there).
  - `bonus-eligibility.service.test.ts` (item 9): add focused tests that each flag fires from its query result with the right type/severity: prior_bonus (warn), device_bonus (warn), ip_bonus (warn), ip_velocity (block when over threshold, warn under). Mock the pool query sequence. Also a direct unit test of `isBonusBlocked` (true when a hard type present or ip_velocity block; false for warn-only ip_velocity alone... note: prior/device/ip_bonus are warn severity but ARE hard-block types, so assert isBonusBlocked is true for them).

- [ ] **Step 5: Full run + tsc** — PASS (claim tests unchanged behavior).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/bonus-eligibility.service.ts apps/api/src/services/bonus-eligibility.service.test.ts apps/api/src/routes/bonuses.ts apps/api/src/routes/bonuses.test.ts apps/api/src/services/bonus-claim.service.ts
git commit -m "feat(api): hide claimable bonuses from abuse-blocked players

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Clear code/criteria on campaign edit (+ PUT edit route tests)

**Files:** Modify `apps/api/src/routes/admin/campaigns.ts` (+ `campaigns.test.ts`)

- [ ] **Step 1: Allow null for code/criteria in the schema.** In `upsertBodyShape`, change `code` and `criteria` from `.optional()` to `.nullish()` (optional + nullable) so the PUT `.partial()` accepts explicit null. (For CREATE, a null code/criteria is equivalent to absent -> pass `null`; the create INSERT already stores null there, so no create behavior change. Verify the create path still coerces `?? null`.)

- [ ] **Step 2: Distinguish absent vs null in the PUT handler.** Read the current PUT `/admin/campaigns/:id` handler. Keep the effective-reward-kind lookup and the no-code-on-deposit_match guard (clearing a code, `d.code === null`, must remain ALLOWED since the guard checks `d.code != null`). Replace the fixed COALESCE UPDATE with a build where `code` and `criteria` are set to the provided value (which may be null) ONLY when the key is present in the raw request body, and all other columns keep COALESCE. Concrete implementation:

```ts
    const d = parsed.data
    const body = (req.body ?? {}) as Record<string, unknown>
    const sets: string[] = [
      'name = COALESCE($2, name)',
      'description = COALESCE($3, description)',
      'amount_cents = COALESCE($4, amount_cents)',
      'expiry_days = COALESCE($5, expiry_days)',
      'starts_at = COALESCE($6, starts_at)',
      'ends_at = COALESCE($7, ends_at)',
      'reward_kind = COALESCE($8, reward_kind)',
      'match_percent = COALESCE($9, match_percent)',
      'max_match_cents = COALESCE($10, max_match_cents)',
      'min_deposit_cents = COALESCE($11, min_deposit_cents)',
    ]
    const vals: unknown[] = [
      id,                          // $1
      d.name ?? null,              // $2
      d.description ?? null,       // $3
      d.amountCents ?? null,       // $4
      d.expiryDays ?? null,        // $5
      d.startsAt ?? null,          // $6
      d.endsAt ?? null,            // $7
      d.rewardKind ?? null,        // $8
      d.matchPercent ?? null,      // $9
      d.maxMatchCents ?? null,     // $10
      d.minDepositCents ?? null,   // $11
    ]
    let n = vals.length
    if ('code' in body) { sets.push(`code = $${++n}`); vals.push(d.code ?? null) }
    if ('criteria' in body) { sets.push(`criteria = $${++n}::jsonb`); vals.push(d.criteria == null ? null : JSON.stringify(d.criteria)) }
    const { rows: updated } = await pool.query<{ id: string }>(
      `UPDATE bonus_campaigns SET ${sets.join(', ')} WHERE id = $1 RETURNING id`,
      vals,
    )
    if (updated.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Campaign not found.' } })
    return reply.send({ id: updated[0].id })
```
(Match the exact column list to the current PUT SET clause — the ten COALESCE columns above are `name, description, amount_cents, expiry_days, starts_at, ends_at, reward_kind, match_percent, max_match_cents, min_deposit_cents`; `key` is not updated. If the current handler's not-found / return shape differs, preserve the existing shape rather than the placeholder above. Keep the existing 23505 -> 409 CODE_TAKEN / CAMPAIGN_KEY_TAKEN catch and the 23514 -> 400 backstop.)

- [ ] **Step 3: Tests (covers item 8).** In `campaigns.test.ts` add:
  - Partial edit: PUT `{ name: 'X' }` updates name only (SET clause has no `code`/`criteria`).
  - Clear code: PUT `{ code: null }` on an existing fixed campaign issues `code = $n` with value null (assert the SQL includes `code =` and the param is null).
  - Clear criteria: PUT `{ criteria: null }` issues `criteria = $n::jsonb` with null.
  - Set code that collides: `23505` on code constraint -> `409 CODE_TAKEN`.
  - No-code-on-deposit_match still enforced (existing test stays green); clearing a code on a deposit_match campaign (`{ code: null }`) is allowed.

- [ ] **Step 4: Full run + tsc** — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/campaigns.ts apps/api/src/routes/admin/campaigns.test.ts
git commit -m "feat(api): allow clearing campaign code/criteria on edit + PUT tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Rewards stale success banner

**Files:** Modify `apps/web/src/app/(player)/rewards/page.tsx`

- [ ] **Step 1: Reset promo success on new attempt + input change.** In `handleApplyCode`, set `setPromoSuccess(null)` at the start (alongside `setPromoError('')`). In the promo `input`'s `onChange`, also clear a lingering success: `setPromoSuccess(null)` when the user edits the field.

- [ ] **Step 2: Reset per-campaign success when re-claiming.** In `handleClaim`, at the start, clear any prior success for that campaign: `setClaimSuccess(prev => { const next = { ...prev }; delete next[campaign.id]; return next })` (alongside the existing `setClaimError` reset). (Claims already remove the campaign from the list on success, so this mainly guards the edge where a campaign reappears.)

- [ ] **Step 3: Typecheck** — `cd apps/web && npx tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(player)/rewards/page.tsx"
git commit -m "fix(web): clear stale bonus success banners on Rewards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Deposit-bonus toast

**Files:** Modify `apps/web/src/app/(player)/layout.tsx`

- [ ] **Step 1: Detect a bonus-balance increase.** Read `layout.tsx`. It holds `profile` (with `wallet.bonus_balance`), re-fetches on the `balanceRefresh` event, and already flashes on cash-balance changes. Add:
  - A `useRef<number | null>(null)` holding the previously-seen `bonus_balance` (start null so the first load does not toast).
  - A `useState` for a transient toast message (string | null).
  - A `useEffect` on `profile?.wallet.bonus_balance`: if the ref is non-null and the new value is greater than the ref, set the toast message ("Bonus added to your account!"); then update the ref to the new value. On the first non-null profile, set the ref without toasting.

- [ ] **Step 2: Render + auto-dismiss the toast.** Render a fixed-position, dependency-free toast (Tailwind, matching the app's dark theme + accent styling, e.g. bottom-center pill with the Gift icon) when the message is set. Auto-dismiss after ~4s via a `setTimeout` in a `useEffect` keyed on the message (clear the timer on cleanup). No toast library.

- [ ] **Step 3: Typecheck** — `cd apps/web && npx tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(player)/layout.tsx"
git commit -m "feat(web): toast when a bonus is added to the account

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Full verification + deploy

- [ ] **Step 1:** `cd apps/api && npx vitest run && npx tsc --noEmit` (all green).
- [ ] **Step 2:** `cd apps/admin && npx tsc --noEmit` and `cd apps/web && npx tsc --noEmit` (clean).
- [ ] **Step 3:** Merge branch to master; push. Deploy API (`srv-d7eb279o3t8c73ebvvdg`), Admin (`srv-d7ee004vikkc73enkl40`), Web (`srv-d7edvs57vvec73ep0shg`). Capture each deploy id, poll to `live`.
- [ ] **Step 4:** Prod smoke: API `/health` 200; `/bonuses/available` 401; `/bonuses/claim` 401; `/admin/campaigns` 401; web dashboard + `/rewards` load 200.

---

## Self-Review Notes

- **Spec coverage:** item 1 -> Task 1; item 2 -> Task 2; item 3 -> Task 3; item 6 (hide blocked) + item 9 (eligibility test) -> Task 4; item 4 (clearable) + item 8 (PUT tests) -> Task 5; item 5 (stale banner) -> Task 6; item 7 (toast) -> Task 7; verify+deploy -> Task 8. All nine items mapped.
- **Type consistency:** `isBonusBlocked(flags)` defined in Task 4 and reused by both the claim service and the list route; `EligibilityFlag`/`FlagType` reused from the eligibility service; the PUT dynamic-SET param numbering is self-consistent ($1 id, $2..$11 COALESCE columns, code/criteria appended).
- **Safety:** no money/claim/deposit behavior changes except intended ones (rate-limit adds a 429 ceiling; hide-when-blocked only removes already-non-claimable rows from the list; criteria status filter only narrows to active players; release fix is defense-in-depth). No migration.
