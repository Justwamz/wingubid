# Bonus Promo Codes + Criteria Targeting (Slice 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional per-campaign promo codes and live audience-criteria targeting, enforced at claim time and reflected in the player Rewards list + admin campaign UI.

**Architecture:** Two nullable columns on `bonus_campaigns` (`code`, `criteria` JSONB). A criteria engine turns `criteria` into a SQL predicate over `players`, used for a per-player match (claim + list) and an admin count preview. The claim flow gains code + criteria gates before the 3a checks. Code-gated campaigns are hidden from the open list; targeted campaigns show only to matching players.

**Tech Stack:** Fastify + `@betting/db` (raw SQL), Zod, Vitest (API); Next.js 14 + Tailwind (admin + web).

## Global Constraints

- Migration `packages/db/migrations/040_campaign_targeting.sql` (next number 040), runs on API boot; additive columns only.
- Money is integer cents. API error shape `{ error: { code, message } }`; `AppError` from `apps/api/src/lib/errors.js`.
- Promo code is one shared code per campaign, stored normalized UPPERCASE, unique when set; compared case-insensitively.
- Targeting is LIVE: a player must match the criteria at claim time and to see a targeted campaign in `/bonuses/available`. No snapshot list.
- Criteria fields (all optional): `registeredWithinDays`, `depositStatus` ('has'|'none'), `minTotalDepositCents`, `bettingActivity` ('has'|'none'). `criteria=null` = untargeted.
- A criteria/targeting mismatch returns `422 NOT_ELIGIBLE` (generic, no criteria detail). A wrong/missing code on a code campaign returns `422 INVALID_CODE`.
- Existing 3a claim/campaign behavior unchanged when a campaign has no code and no criteria.
- ESM `.js` import extensions. No em-dashes in source or UI copy.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Tests: `cd apps/api && npx vitest run <path>`; typecheck api/admin/web `npx tsc --noEmit`.

## File Structure

**API (create):** `packages/db/migrations/040_campaign_targeting.sql`; `apps/api/src/services/bonus-criteria.service.ts` + test.
**API (modify):** `apps/api/src/services/bonus-claim.service.ts` (+ test); `apps/api/src/routes/bonuses.ts` (+ test); `apps/api/src/routes/admin/campaigns.ts` (+ test).
**Admin (modify):** `apps/admin/src/components/CampaignsTab.tsx`.
**Web (modify):** `apps/web/src/app/(player)/rewards/page.tsx`.

---

## Task 1: Migration 040

**Files:** Create `packages/db/migrations/040_campaign_targeting.sql`
**Interfaces:** Produces `bonus_campaigns.code` (unique when set) + `bonus_campaigns.criteria` JSONB.

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE bonus_campaigns
  ADD COLUMN IF NOT EXISTS code     VARCHAR(40),
  ADD COLUMN IF NOT EXISTS criteria JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bonus_campaigns_code
  ON bonus_campaigns(code) WHERE code IS NOT NULL;
```

- [ ] **Step 2: Typecheck** — `cd apps/api && npx tsc --noEmit` (no errors).
- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/040_campaign_targeting.sql
git commit -m "feat(db): campaign promo code + criteria columns

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Criteria engine

**Files:** Create `apps/api/src/services/bonus-criteria.service.ts` + `bonus-criteria.service.test.ts`
**Interfaces:** Produces `interface Criteria`; `buildCriteria`, `playerMatchesCriteria`, `countMatchingPlayers`, `criteriaSchema`.

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/services/bonus-criteria.service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@betting/db'
import { buildCriteria, playerMatchesCriteria, countMatchingPlayers } from './bonus-criteria.service.js'

const mockQuery = vi.mocked(pool.query)
beforeEach(() => mockQuery.mockReset())

describe('buildCriteria', () => {
  it('returns TRUE with no params for empty/null criteria', () => {
    expect(buildCriteria(null)).toEqual({ where: 'TRUE', params: [] })
    expect(buildCriteria({})).toEqual({ where: 'TRUE', params: [] })
  })
  it('builds registered-within-days + deposit + betting conditions', () => {
    const { where, params } = buildCriteria({ registeredWithinDays: 7, depositStatus: 'none', bettingActivity: 'has' })
    expect(where).toContain('make_interval(days =>')
    expect(where).toContain("NOT EXISTS")
    expect(where).toContain("FROM bets b")
    expect(params).toContain(7)
  })
})

describe('playerMatchesCriteria', () => {
  it('returns true for empty criteria without querying', async () => {
    expect(await playerMatchesCriteria('p1', null)).toBe(true)
    expect(mockQuery).not.toHaveBeenCalled()
  })
  it('returns the DB match result for real criteria', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ m: true }] } as never)
    expect(await playerMatchesCriteria('p1', { registeredWithinDays: 7 })).toBe(true)
  })
})

describe('countMatchingPlayers', () => {
  it('returns the count', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '42' }] } as never)
    expect(await countMatchingPlayers({ depositStatus: 'has' })).toBe(42)
  })
})
```

- [ ] **Step 2: Run to verify fail** — `cd apps/api && npx vitest run src/services/bonus-criteria.service.test.ts` (module not found).

- [ ] **Step 3: Implement**

Create `apps/api/src/services/bonus-criteria.service.ts`:

```ts
import { z } from 'zod'
import { pool } from '@betting/db'

export interface Criteria {
  registeredWithinDays?: number
  depositStatus?: 'has' | 'none'
  minTotalDepositCents?: number
  bettingActivity?: 'has' | 'none'
}

export const criteriaSchema = z.object({
  registeredWithinDays: z.number().int().min(1).max(3650).optional(),
  depositStatus: z.enum(['has', 'none']).optional(),
  minTotalDepositCents: z.number().int().min(1).optional(),
  bettingActivity: z.enum(['has', 'none']).optional(),
}).strict()

// Turn criteria into a parameterized WHERE fragment over players (alias `pl`).
// Empty/null -> 'TRUE'. Reused for the per-player check and the admin count.
export function buildCriteria(criteria: Criteria | null | undefined): { where: string; params: unknown[] } {
  const conds: string[] = []
  const params: unknown[] = []
  const p = (v: unknown) => { params.push(v); return `$${params.length}` }
  if (criteria) {
    if (criteria.registeredWithinDays != null) {
      conds.push(`pl.created_at >= NOW() - make_interval(days => ${p(criteria.registeredWithinDays)})`)
    }
    if (criteria.depositStatus === 'has') {
      conds.push(`EXISTS (SELECT 1 FROM transactions t WHERE t.player_id = pl.id AND t.type = 'deposit' AND t.status = 'completed')`)
    } else if (criteria.depositStatus === 'none') {
      conds.push(`NOT EXISTS (SELECT 1 FROM transactions t WHERE t.player_id = pl.id AND t.type = 'deposit' AND t.status = 'completed')`)
    }
    if (criteria.minTotalDepositCents != null) {
      conds.push(`(SELECT COALESCE(SUM(amount), 0) FROM transactions t WHERE t.player_id = pl.id AND t.type = 'deposit' AND t.status = 'completed') >= ${p(criteria.minTotalDepositCents)}`)
    }
    if (criteria.bettingActivity === 'has') {
      conds.push(`EXISTS (SELECT 1 FROM bets b WHERE b.player_id = pl.id)`)
    } else if (criteria.bettingActivity === 'none') {
      conds.push(`NOT EXISTS (SELECT 1 FROM bets b WHERE b.player_id = pl.id)`)
    }
  }
  return { where: conds.length ? conds.join(' AND ') : 'TRUE', params }
}

export async function playerMatchesCriteria(playerId: string, criteria: Criteria | null | undefined): Promise<boolean> {
  const { where, params } = buildCriteria(criteria)
  if (where === 'TRUE') return true
  params.push(playerId)
  const { rows } = await pool.query<{ m: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM players pl WHERE (${where}) AND pl.id = $${params.length}) AS m`,
    params,
  )
  return rows[0].m
}

export async function countMatchingPlayers(criteria: Criteria | null | undefined): Promise<number> {
  const { where, params } = buildCriteria(criteria)
  const { rows } = await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM players pl WHERE (${where})`, params)
  return Number(rows[0].n)
}
```

- [ ] **Step 4: Run tests + tsc** — `cd apps/api && npx vitest run src/services/bonus-criteria.service.test.ts && npx tsc --noEmit` (PASS).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/bonus-criteria.service.ts apps/api/src/services/bonus-criteria.service.test.ts
git commit -m "feat(api): campaign targeting criteria engine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Claim flow + player routes (code + criteria)

**Files:** Modify `apps/api/src/services/bonus-claim.service.ts` (+ `bonus-claim.service.test.ts`), `apps/api/src/routes/bonuses.ts` (+ `bonuses.test.ts`)
**Interfaces:** `claimCampaignBonus(playerId, campaignId, ip, deviceId, code?)`; `resolveCampaignByCode(code): Promise<string | null>`.

- [ ] **Step 1: Write failing tests**

In `apps/api/src/services/bonus-claim.service.test.ts` add (also mock `./bonus-criteria.service.js`): a code campaign with a wrong/missing code -> `INVALID_CODE`; correct code -> proceeds; a campaign with criteria where `playerMatchesCriteria` resolves false -> `NOT_ELIGIBLE` and grantBonus NOT called. In `apps/api/src/routes/bonuses.test.ts` add: `POST /bonuses/claim` with only a `code` resolves + claims; with neither campaignId nor code -> 400. Follow the existing mock patterns in those files (they mock `@betting/db`, and the route test mocks `../services/bonus-claim.service.js`). Include `code`/`criteria` columns in the campaign-select mock rows.

- [ ] **Step 2: Run to verify fail** — the new cases fail (no code/criteria handling, resolve not exported).

- [ ] **Step 3: Implement the claim service**

In `apps/api/src/services/bonus-claim.service.ts`:
- Add import: `import { playerMatchesCriteria, type Criteria } from './bonus-criteria.service.js'`
- Add a resolver:

```ts
export async function resolveCampaignByCode(code: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM bonus_campaigns WHERE code = $1`, [code.trim().toUpperCase()],
  )
  return rows.length ? rows[0].id : null
}
```

- Change the signature and campaign select, and add the two gates after the active/window check and before the already-claimed check:

```ts
export async function claimCampaignBonus(
  playerId: string,
  campaignId: string,
  ip: string | undefined,
  deviceId: string | undefined,
  code?: string,
): Promise<{ amountCents: number }> {
  const { rows: camp } = await pool.query<{
    amount_cents: string; expiry_days: number; status: string
    starts_at: string | null; ends_at: string | null
    code: string | null; criteria: Criteria | null
  }>(
    `SELECT amount_cents, expiry_days, status, starts_at, ends_at, code, criteria
     FROM bonus_campaigns WHERE id = $1`,
    [campaignId],
  )
  if (camp.length === 0) throw new AppError('CAMPAIGN_UNAVAILABLE', 'This bonus is not available.', 422)
  const c = camp[0]
  const now = Date.now()
  const notStarted = c.starts_at && new Date(c.starts_at).getTime() > now
  const ended = c.ends_at && new Date(c.ends_at).getTime() < now
  if (c.status !== 'active' || notStarted || ended) {
    throw new AppError('CAMPAIGN_UNAVAILABLE', 'This bonus is not available.', 422)
  }

  // Promo code gate.
  if (c.code) {
    if (!code || code.trim().toUpperCase() !== c.code.toUpperCase()) {
      throw new AppError('INVALID_CODE', 'That promo code is not valid.', 422)
    }
  }
  // Audience targeting gate (generic message; no criteria detail leaked).
  if (c.criteria && !(await playerMatchesCriteria(playerId, c.criteria))) {
    throw new AppError('NOT_ELIGIBLE', "You're not eligible for this bonus.", 422)
  }

  // ... existing checks unchanged: already-claimed, active-bonus, claim signal,
  //     abuse eligibility, atomic grant + claim ...
```

Leave the rest of the function body exactly as-is.

- [ ] **Step 4: Implement the player routes**

In `apps/api/src/routes/bonuses.ts`:
- `POST /bonuses/claim`: accept `campaignId?` OR `code?`:

```ts
  app.post('/bonuses/claim', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({
      campaignId: z.string().uuid().optional(),
      code: z.string().min(1).max(40).optional(),
      deviceId: z.string().max(64).optional(),
    }).refine(d => Boolean(d.campaignId) || Boolean(d.code), { message: 'Provide a bonus or a promo code.' })
      .safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    try {
      let campaignId = parsed.data.campaignId
      if (!campaignId && parsed.data.code) {
        campaignId = (await resolveCampaignByCode(parsed.data.code)) ?? undefined
        if (!campaignId) return reply.status(422).send({ error: { code: 'INVALID_CODE', message: 'That promo code is not valid.' } })
      }
      const { amountCents } = await claimCampaignBonus(req.playerId, campaignId!, req.ip, parsed.data.deviceId, parsed.data.code)
      return reply.send({ ok: true, amountCents })
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })
```
Add `resolveCampaignByCode` to the import from `../services/bonus-claim.service.js`.

- `GET /bonuses/available`: exclude code campaigns, then filter targeted campaigns live:

```ts
  app.get('/bonuses/available', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await pool.query<{
      id: string; key: string; name: string; description: string | null
      amount_cents: string; criteria: import('../services/bonus-criteria.service.js').Criteria | null; claimable: boolean
    }>(
      `SELECT c.id, c.key, c.name, c.description, c.amount_cents, c.criteria,
              (NOT EXISTS (SELECT 1 FROM bonus_grants g WHERE g.player_id = $1 AND g.status = 'active')) AS claimable
       FROM bonus_campaigns c
       WHERE c.status = 'active' AND c.code IS NULL
         AND (c.starts_at IS NULL OR c.starts_at <= NOW())
         AND (c.ends_at IS NULL OR c.ends_at >= NOW())
         AND NOT EXISTS (SELECT 1 FROM bonus_claims bc WHERE bc.campaign_id = c.id AND bc.player_id = $1)
       ORDER BY c.created_at DESC`,
      [req.playerId],
    )
    const out = []
    for (const r of rows) {
      if (r.criteria && !(await playerMatchesCriteria(req.playerId, r.criteria))) continue
      out.push({ id: r.id, key: r.key, name: r.name, description: r.description, amountCents: Number(r.amount_cents), claimable: r.claimable })
    }
    return reply.send({ campaigns: out })
  })
```
Add `playerMatchesCriteria` to imports from `../services/bonus-criteria.service.js`.

- [ ] **Step 5: Run tests + full suite + tsc** — `cd apps/api && npx vitest run src/services/bonus-claim.service.test.ts src/routes/bonuses.test.ts && npx vitest run && npx tsc --noEmit` (PASS; existing 3a claim tests stay green — no code/criteria on their mock rows means both gates skip).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/bonus-claim.service.ts apps/api/src/services/bonus-claim.service.test.ts apps/api/src/routes/bonuses.ts apps/api/src/routes/bonuses.test.ts
git commit -m "feat(api): claim by code + criteria gate; hide code campaigns from list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Admin campaign routes (code + criteria + preview)

**Files:** Modify `apps/api/src/routes/admin/campaigns.ts` (+ `campaigns.test.ts`)
**Interfaces:** create/edit accept `code?`, `criteria?`; `POST /admin/campaigns/preview-count`.

- [ ] **Step 1: Write failing tests**

In `apps/api/src/routes/admin/campaigns.test.ts` add: create with a `code` returns id (mock insert), a second create hitting the code unique index (`23505` with `constraint: 'uq_bonus_campaigns_code'`) -> `409 CODE_TAKEN`; `POST /admin/campaigns/preview-count` with a criteria body returns `{ count }` (mock `bonus-criteria.service` `countMatchingPlayers`). Add `vi.mock('../../services/bonus-criteria.service.js', ...)` returning `countMatchingPlayers` and a passthrough `criteriaSchema` (import the real one is fine — but if mocking, provide a `criteriaSchema` that `.safeParse`s; simplest: do NOT mock criteriaSchema, only countMatchingPlayers, by using `vi.importActual`). Prefer: `vi.mock('../../services/bonus-criteria.service.js', async (orig) => ({ ...(await orig()), countMatchingPlayers: vi.fn(async () => 42) }))`.

- [ ] **Step 2: Run to verify fail**.

- [ ] **Step 3: Implement**

In `apps/api/src/routes/admin/campaigns.ts`:
- Import: `import { criteriaSchema, countMatchingPlayers } from '../../services/bonus-criteria.service.js'`
- Extend the create/edit `upsertBody` with `code: z.string().trim().min(2).max(40).optional()` and `criteria: criteriaSchema.optional()`.
- On create, normalize the code (`d.code ? d.code.toUpperCase() : null`) and pass `criteria` (`d.criteria ? JSON.stringify(d.criteria) : null`) into the INSERT (add `code`, `criteria` columns). On edit, `COALESCE` them in too. Include `code`, `criteria` in the list SELECT.
- Map the unique-violation by constraint:

```ts
      if ((err as { code?: string }).code === '23505') {
        const constraint = (err as { constraint?: string }).constraint
        if (constraint === 'uq_bonus_campaigns_code') return reply.status(409).send({ error: { code: 'CODE_TAKEN', message: 'That promo code is already in use.' } })
        return reply.status(409).send({ error: { code: 'CAMPAIGN_KEY_TAKEN', message: 'That campaign key already exists.' } })
      }
```

- Add the preview route:

```ts
  app.post('/admin/campaigns/preview-count', { preHandler: [authenticateAdmin, requirePermission('campaigns.view')] }, async (req, reply) => {
    const parsed = z.object({ criteria: criteriaSchema.optional() }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    const count = await countMatchingPlayers(parsed.data.criteria ?? null)
    return reply.send({ count })
  })
```

- [ ] **Step 4: Run tests + full suite + tsc** — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/campaigns.ts apps/api/src/routes/admin/campaigns.test.ts
git commit -m "feat(api): admin campaign code + criteria + audience preview count

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Admin CampaignsTab (code + criteria builder + preview)

**Files:** Modify `apps/admin/src/components/CampaignsTab.tsx`

- [ ] **Step 1: Add code + targeting to the form**

Read `CampaignsTab.tsx`. In the create/edit form add: a **Promo code** text input (optional; uppercased on send); a **Targeting** section with `registeredWithinDays` (number, optional), `depositStatus` (select: any/has/none), `minTotalDepositCents` (number KES -> cents, optional), `bettingActivity` (select: any/has/none). Build a `criteria` object from the non-empty fields and include `code`/`criteria` in the create payload (omit when empty). After a change to targeting fields (debounced ~400ms), POST `/admin/campaigns/preview-count` `{ criteria }` and show "Matches N players". In the table, show a code badge and a short criteria summary. Handle `CODE_TAKEN` error message. Keep `@/lib/api` `{data,error}` usage, kes() formatting, no em-dashes.

- [ ] **Step 2: Typecheck** — `cd apps/admin && npx tsc --noEmit` (clean).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/components/CampaignsTab.tsx
git commit -m "feat(admin): campaign promo code + criteria builder with live count

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Player Rewards promo-code entry

**Files:** Modify `apps/web/src/app/(player)/rewards/page.tsx`

- [ ] **Step 1: Add the promo-code input**

Read the Rewards page. Add a "Have a promo code?" text input + Apply button that POSTs `/bonuses/claim` with `{ code, deviceId: getDeviceId() }` (reuse the existing claim handler/pattern). On success show the credited amount + dispatch `balanceRefresh` and refresh the list; on error show the friendly `error.message` (covers `INVALID_CODE`, `NOT_ELIGIBLE`, `ALREADY_CLAIMED`, `ACTIVE_BONUS_EXISTS`). Keep existing listed-campaign claims working. No em-dashes.

- [ ] **Step 2: Typecheck** — `cd apps/web && npx tsc --noEmit` (clean).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(player)/rewards/page.tsx"
git commit -m "feat(web): claim a bonus by promo code on Rewards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full verification + deploy

- [ ] **Step 1:** `cd apps/api && npx vitest run && npx tsc --noEmit` (all green).
- [ ] **Step 2:** `cd apps/admin && npx tsc --noEmit` and `cd apps/web && npx tsc --noEmit` (clean).
- [ ] **Step 3:** Push branch; deploy API (`srv-d7eb279o3t8c73ebvvdg`, migration 040) then Admin (`srv-d7ee004vikkc73enkl40`) then Web (`srv-d7edvs57vvec73ep0shg`). Capture each deploy id (`grep -oE '"id":"dep-[^"]*"'`), poll to `live`.
- [ ] **Step 4:** Prod smoke: `/admin/campaigns/preview-count` (401), `/bonuses/claim` (401). Confirm log shows `applied 040_campaign_targeting.sql`.
- [ ] **Step 5:** Manual: admin create a code campaign (code SAVE10) + a targeted campaign (registered <=7d). Player: code campaign hidden from list; entering SAVE10 claims it; targeted campaign shows only to a matching (new) player; wrong code -> "not valid".

---

## Self-Review Notes

- **Spec coverage:** code + criteria columns (Task 1); criteria engine (Task 2); claim code+criteria gates + claim-by-code + list exclusion/filter (Task 3); admin code+criteria+preview (Task 4); admin UI (Task 5); player promo entry (Task 6); verify+deploy (Task 7). All spec sections map to a task.
- **Type consistency:** `Criteria`, `buildCriteria`, `playerMatchesCriteria`, `countMatchingPlayers`, `criteriaSchema` consistent across Tasks 2-5; `claimCampaignBonus(..., code?)` + `resolveCampaignByCode` consistent Task 3; `code`/`criteria` payload fields consistent Tasks 4-6.
- **Backward safety:** both new gates are skipped when `code`/`criteria` are null, so 3a campaigns and their tests are unaffected; columns are additive/nullable.
