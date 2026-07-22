# Bonus Campaigns + Self-Service Welcome Claim (Slice 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-configurable bonus campaigns and a player self-service claim (welcome/custom, fixed amount), reusing the Slice-2 abuse engine at claim time with strict enforcement.

**Architecture:** `bonus_campaigns` + `bonus_claims` (unique per campaign+player) tables; `bonus_grants` gains `campaign` source + `campaign_id`. A claim service runs active-window + one-active-bonus + one-per-campaign + abuse checks, then atomically grants the bonus and records the claim. Admin CRUD manages campaigns; a player Rewards page claims them.

**Tech Stack:** Fastify + `@betting/db` (raw SQL, pg pool), Zod, Vitest (API); Next.js 14 + Tailwind (admin + web). `req.ip` trustworthy (trustProxy on).

## Global Constraints

- Migrations plain SQL in `packages/db/migrations`, numbered `NNN_name.sql`; this is **039**.
- API error shape always `{ error: { code, message } }`; use `AppError` from `apps/api/src/lib/errors.js` (player-facing) — note `apps/api/src/routes/player/*` import `AppError` from `../../services/auth.service.js`; match the file you edit.
- Money is integer cents. Campaign grants use the GLOBAL win cap at settlement (unchanged Slice 1); only expiry is per-campaign.
- Self-service claim enforcement is strict: flags `prior_bonus`, `device_bonus`, `ip_bonus`, or `ip_velocity`(severity block) -> reject `422 NOT_ELIGIBLE` with a friendly message (no signal detail leaked).
- Claim-signal IP validated with `net.isIP` and capture is best-effort (never fails a claim).
- New RBAC permissions `campaigns.view`, `campaigns.manage` in the code catalog.
- ESM `.js` import extensions. No em-dashes in source or UI copy.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Tests: `cd apps/api && npx vitest run <path>`; typecheck api/admin/web with `npx tsc --noEmit`.
- Existing bonus/grant/register/eligibility tests stay green (grantBonus defaults preserved).

## File Structure

**API (create):** `packages/db/migrations/039_bonus_campaigns.sql`; `apps/api/src/services/bonus-claim.service.ts` + test; `apps/api/src/routes/bonuses.ts` (player) + test; `apps/api/src/routes/admin/campaigns.ts` + test.
**API (modify):** `apps/api/src/services/wallet.service.ts` (grantBonus opts); `apps/api/src/services/bonus-eligibility.service.ts` (broaden subqueries); `apps/api/src/lib/permissions.ts` (campaigns area); `apps/api/src/server.ts` (register routes).
**Admin (create):** `apps/admin/src/components/CampaignsTab.tsx`. **(modify)** `apps/admin/src/app/dashboard/page.tsx`.
**Web (create):** `apps/web/src/app/(player)/rewards/page.tsx`. **(modify)** `apps/web/src/app/(player)/layout.tsx` (nav link).

---

## Task 1: Migration 039

**Files:** Create `packages/db/migrations/039_bonus_campaigns.sql`
**Interfaces:** Produces `bonus_campaigns`, `bonus_claims` tables; `bonus_grants.source` widened to include `campaign`; `bonus_grants.campaign_id`.

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS bonus_campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           VARCHAR(40) UNIQUE NOT NULL,
  name          VARCHAR(120) NOT NULL,
  description   VARCHAR(500),
  type          VARCHAR(20) NOT NULL CHECK (type IN ('welcome','custom')),
  reward_kind   VARCHAR(20) NOT NULL DEFAULT 'fixed' CHECK (reward_kind IN ('fixed')),
  amount_cents  BIGINT NOT NULL CHECK (amount_cents > 0),
  expiry_days   INT NOT NULL DEFAULT 30 CHECK (expiry_days BETWEEN 1 AND 365),
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  created_by    UUID REFERENCES admin_users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bonus_claims (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES bonus_campaigns(id),
  player_id   UUID NOT NULL REFERENCES players(id),
  grant_id    UUID REFERENCES bonus_grants(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_bonus_claims_player ON bonus_claims(player_id);

ALTER TABLE bonus_grants DROP CONSTRAINT IF EXISTS bonus_grants_source_check;
ALTER TABLE bonus_grants ADD CONSTRAINT bonus_grants_source_check
  CHECK (source IN ('manual','campaign'));
ALTER TABLE bonus_grants ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES bonus_campaigns(id);
```

- [ ] **Step 2: Typecheck** — `cd apps/api && npx tsc --noEmit` (no errors).
- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/039_bonus_campaigns.sql
git commit -m "feat(db): bonus_campaigns + bonus_claims + grant campaign source

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: grantBonus campaign support + eligibility broadening

**Files:** Modify `apps/api/src/services/wallet.service.ts`, `apps/api/src/services/bonus-eligibility.service.ts`; Test `apps/api/src/services/wallet.service.test.ts`
**Interfaces:** Produces `grantBonus(client, playerId, amount, grantedBy: string | null, expiresAt, opts?: { source?: 'manual'|'campaign'; campaignId?: string | null })`.

- [ ] **Step 1: Write a failing test**

Add to `apps/api/src/services/wallet.service.test.ts` (mirror the existing grantBonus/settleBonusWin test style with a fake client):

```ts
import { grantBonus } from './wallet.service.js'

describe('grantBonus campaign source', () => {
  it('writes source=campaign + campaign_id when opts provided', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = []
    const client = { query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      if (sql.includes('SELECT id, balance')) return { rows: [{ id: 'w1', balance: '0', currency: 'KES' }] }
      if (sql.includes('INSERT INTO bonus_grants')) return { rows: [{ id: 'g1' }] }
      if (sql.startsWith('UPDATE wallets')) return { rows: [{ bonus_balance: '5000' }] }
      return { rows: [{ id: 'tx1' }] }
    }) } as never
    const { grantId } = await grantBonus(client, 'p1', 5000, null, new Date(), { source: 'campaign', campaignId: 'c1' })
    expect(grantId).toBe('g1')
    const insert = calls.find(c => c.sql.includes('INSERT INTO bonus_grants'))!
    expect(insert.params).toContain('campaign')
    expect(insert.params).toContain('c1')
  })
})
```

- [ ] **Step 2: Run to verify fail** — `cd apps/api && npx vitest run src/services/wallet.service.test.ts` (FAIL: opts not supported / manual hardcoded).

- [ ] **Step 3: Implement grantBonus opts**

Replace the current `grantBonus` in `apps/api/src/services/wallet.service.ts` with:

```ts
export async function grantBonus(
  client: PoolClient,
  playerId: string,
  amount: number,
  grantedBy: string | null,
  expiresAt: Date,
  opts: { source?: 'manual' | 'campaign'; campaignId?: string | null } = {},
): Promise<{ grantId: string }> {
  const source = opts.source ?? 'manual'
  const campaignId = opts.campaignId ?? null
  const wallet = await selectWalletForUpdate(client, playerId)
  const { rows: grantRows } = await client.query<{ id: string }>(
    `INSERT INTO bonus_grants (player_id, wallet_id, source, campaign_id, amount_granted, remaining, status, granted_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $5, 'active', $6, $7) RETURNING id`,
    [playerId, wallet.id, source, campaignId, amount, grantedBy, expiresAt],
  )
  const { rows: updated } = await client.query<{ bonus_balance: string }>(
    `UPDATE wallets SET bonus_balance = bonus_balance + $1 WHERE player_id = $2 RETURNING bonus_balance`,
    [amount, playerId],
  )
  await client.query(
    `INSERT INTO transactions (wallet_id, player_id, type, amount, balance_after, status, metadata)
     VALUES ($1, $2, 'bonus_granted', $3, $4, 'completed', $5::jsonb)`,
    [wallet.id, playerId, amount, Number(updated[0].bonus_balance), JSON.stringify({ grantId: grantRows[0].id, grantedBy, source, campaignId })],
  )
  return { grantId: grantRows[0].id }
}
```

- [ ] **Step 4: Broaden the eligibility subqueries**

In `apps/api/src/services/bonus-eligibility.service.ts`, change every `kind = 'signup'` to `kind IN ('signup','claim')` (the three subqueries scoping to this player's signals AND the velocity outer filter) so a claim's own IP/device count. No other logic changes.

- [ ] **Step 5: Run tests + tsc**

Run: `cd apps/api && npx vitest run src/services/wallet.service.test.ts src/services/bonus-eligibility.service.test.ts && npx tsc --noEmit`
Expected: PASS (existing manual grantBonus + admin bonus route tests still green; eligibility tests are mock-based so unaffected). Then `npx vitest run` (full) to confirm.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/wallet.service.ts apps/api/src/services/wallet.service.test.ts apps/api/src/services/bonus-eligibility.service.ts
git commit -m "feat(api): grantBonus campaign source + eligibility counts claim signals

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Claim service + player routes

**Files:** Create `apps/api/src/services/bonus-claim.service.ts` + test; `apps/api/src/routes/bonuses.ts` + test; Modify `apps/api/src/server.ts`
**Interfaces:** Consumes `grantBonus`, `evaluateBonusEligibility`. Produces `claimCampaignBonus(playerId, campaignId, ip, deviceId): Promise<{ amountCents: number }>`; routes `GET /bonuses/available`, `POST /bonuses/claim`; registered `bonusPlayerRoutes`.

- [ ] **Step 1: Write the claim service**

Create `apps/api/src/services/bonus-claim.service.ts`:

```ts
import net from 'net'
import { pool } from '@betting/db'
import { AppError } from '../lib/errors.js'
import { grantBonus } from './wallet.service.js'
import { evaluateBonusEligibility } from './bonus-eligibility.service.js'

const BLOCKING_TYPES = new Set(['prior_bonus', 'device_bonus', 'ip_bonus'])

// Self-service claim of a campaign bonus. Strict abuse enforcement (no admin to
// review): hard-signal flags block the claim. Best-effort claim-signal capture.
export async function claimCampaignBonus(
  playerId: string,
  campaignId: string,
  ip: string | undefined,
  deviceId: string | undefined,
): Promise<{ amountCents: number }> {
  const { rows: camp } = await pool.query<{
    amount_cents: string; expiry_days: number; status: string
    starts_at: string | null; ends_at: string | null
  }>(
    `SELECT amount_cents, expiry_days, status, starts_at, ends_at FROM bonus_campaigns WHERE id = $1`,
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

  const { rows: claimed } = await pool.query(
    `SELECT 1 FROM bonus_claims WHERE campaign_id = $1 AND player_id = $2`, [campaignId, playerId],
  )
  if (claimed.length > 0) throw new AppError('ALREADY_CLAIMED', "You've already claimed this bonus.", 422)

  const { rows: active } = await pool.query(
    `SELECT 1 FROM bonus_grants WHERE player_id = $1 AND status = 'active'`, [playerId],
  )
  if (active.length > 0) throw new AppError('ACTIVE_BONUS_EXISTS', 'Finish your current bonus before claiming another.', 422)

  // Best-effort claim signal (validated IP), before eligibility so it counts.
  const sigIp = ip && net.isIP(ip) ? ip : null
  if (sigIp || deviceId) {
    try {
      await pool.query(
        `INSERT INTO player_signals (player_id, kind, ip, device_id) VALUES ($1, 'claim', $2, $3)`,
        [playerId, sigIp, deviceId ? deviceId.slice(0, 64) : null],
      )
    } catch { /* non-critical */ }
  }

  const { flags } = await evaluateBonusEligibility(playerId)
  const blocked = flags.find(f => BLOCKING_TYPES.has(f.type) || (f.type === 'ip_velocity' && f.severity === 'block'))
  if (blocked) {
    throw new AppError('NOT_ELIGIBLE', "You're not eligible for this bonus.", 422)
  }

  const amount = Number(c.amount_cents)
  const expiresAt = new Date(now + c.expiry_days * 24 * 60 * 60 * 1000)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { grantId } = await grantBonus(client, playerId, amount, null, expiresAt, { source: 'campaign', campaignId })
    await client.query(
      `INSERT INTO bonus_claims (campaign_id, player_id, grant_id) VALUES ($1, $2, $3)`,
      [campaignId, playerId, grantId],
    )
    await client.query('COMMIT')
    return { amountCents: amount }
  } catch (err) {
    await client.query('ROLLBACK')
    if ((err as { code?: string }).code === '23505') {
      throw new AppError('ALREADY_CLAIMED', "You've already claimed this bonus.", 422)
    }
    throw err
  } finally {
    client.release()
  }
}
```

- [ ] **Step 2: Write failing route tests**

Create `apps/api/src/routes/bonuses.test.ts`:

```ts
import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: vi.fn(async (req: { playerId: string }) => { req.playerId = 'player-1' }),
}))
vi.mock('../services/bonus-claim.service.js', () => ({ claimCampaignBonus: vi.fn() }))
vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { buildServer } from '../server.js'
import { pool } from '@betting/db'
import { claimCampaignBonus } from '../services/bonus-claim.service.js'

const mockQuery = vi.mocked(pool.query)
const CAMP = '11111111-1111-1111-1111-111111111111'

describe('GET /bonuses/available', () => {
  const app = buildServer(); afterAll(() => app.close())
  it('lists claimable campaigns', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CAMP, key: 'welcome', name: 'Welcome', description: 'x', amount_cents: '5000', claimable: true }] } as never)
    const res = await app.inject({ method: 'GET', url: '/bonuses/available', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().campaigns[0].key).toBe('welcome')
  })
})

describe('POST /bonuses/claim', () => {
  const app = buildServer(); afterAll(() => app.close())
  it('claims and returns the amount', async () => {
    vi.mocked(claimCampaignBonus).mockResolvedValueOnce({ amountCents: 5000 })
    const res = await app.inject({ method: 'POST', url: '/bonuses/claim', headers: { Authorization: 'Bearer t' }, payload: { campaignId: CAMP } })
    expect(res.statusCode).toBe(200)
    expect(res.json().amountCents).toBe(5000)
  })
  it('surfaces NOT_ELIGIBLE as 422', async () => {
    const { AppError } = await import('../lib/errors.js')
    vi.mocked(claimCampaignBonus).mockRejectedValueOnce(new AppError('NOT_ELIGIBLE', "You're not eligible for this bonus.", 422))
    const res = await app.inject({ method: 'POST', url: '/bonuses/claim', headers: { Authorization: 'Bearer t' }, payload: { campaignId: CAMP } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('NOT_ELIGIBLE')
  })
  it('rejects a non-uuid campaignId', async () => {
    const res = await app.inject({ method: 'POST', url: '/bonuses/claim', headers: { Authorization: 'Bearer t' }, payload: { campaignId: 'x' } })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 3: Run to verify fail** — `cd apps/api && npx vitest run src/routes/bonuses.test.ts` (FAIL: routes 404).

- [ ] **Step 4: Implement the player routes**

Create `apps/api/src/routes/bonuses.ts`:

```ts
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticate } from '../middleware/authenticate.js'
import { AppError } from '../lib/errors.js'
import { claimCampaignBonus } from '../services/bonus-claim.service.js'

export async function bonusPlayerRoutes(app: FastifyInstance) {
  // Active, in-window campaigns this player has not claimed. `claimable` is the
  // cheap check (not claimed, no active bonus); the full abuse check runs at claim.
  app.get('/bonuses/available', { preHandler: authenticate }, async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT c.id, c.key, c.name, c.description, c.amount_cents,
              (NOT EXISTS (SELECT 1 FROM bonus_grants g WHERE g.player_id = $1 AND g.status = 'active')) AS claimable
       FROM bonus_campaigns c
       WHERE c.status = 'active'
         AND (c.starts_at IS NULL OR c.starts_at <= NOW())
         AND (c.ends_at IS NULL OR c.ends_at >= NOW())
         AND NOT EXISTS (SELECT 1 FROM bonus_claims bc WHERE bc.campaign_id = c.id AND bc.player_id = $1)
       ORDER BY c.created_at DESC`,
      [req.playerId],
    )
    return reply.send({ campaigns: rows.map(r => ({
      id: r.id, key: r.key, name: r.name, description: r.description,
      amountCents: Number(r.amount_cents), claimable: r.claimable,
    })) })
  })

  app.post('/bonuses/claim', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({
      campaignId: z.string().uuid(),
      deviceId: z.string().max(64).optional(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    try {
      const { amountCents } = await claimCampaignBonus(req.playerId, parsed.data.campaignId, req.ip, parsed.data.deviceId)
      return reply.send({ ok: true, amountCents })
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
  })
}
```

- [ ] **Step 5: Register in server.ts**

Import `import { bonusPlayerRoutes } from './routes/bonuses.js'` and add `app.register(bonusPlayerRoutes)` with the other player routes.

- [ ] **Step 6: Write a claim-service test**

Create `apps/api/src/services/bonus-claim.service.test.ts` mocking `@betting/db`, `./wallet.service.js` (grantBonus) and `./bonus-eligibility.service.js` (evaluateBonusEligibility). Cover: happy path (campaign active, not claimed, no active bonus, no flags -> grantBonus + claim insert, returns amount); already-claimed -> 422; active bonus -> 422; paused/out-of-window -> 422; a blocking flag -> 422 NOT_ELIGIBLE and grantBonus NOT called. Follow the `pool.query`/`pool.connect` mock pattern used in other service tests (fixed-order `mockResolvedValueOnce` for the pre-checks, a fake client for the transaction).

- [ ] **Step 7: Run tests + full suite + tsc**

Run: `cd apps/api && npx vitest run src/routes/bonuses.test.ts src/services/bonus-claim.service.test.ts && npx vitest run && npx tsc --noEmit`
Expected: PASS, full suite green, clean.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/bonus-claim.service.ts apps/api/src/services/bonus-claim.service.test.ts apps/api/src/routes/bonuses.ts apps/api/src/routes/bonuses.test.ts apps/api/src/server.ts
git commit -m "feat(api): self-service bonus claim (strict abuse enforcement)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Permissions + admin campaign routes

**Files:** Modify `apps/api/src/lib/permissions.ts`; Create `apps/api/src/routes/admin/campaigns.ts` + test; Modify `apps/api/src/server.ts`
**Interfaces:** Permissions `campaigns.view`, `campaigns.manage`; routes `GET/POST/PUT /admin/campaigns`, `PUT /admin/campaigns/:id/status`; registered `adminCampaignRoutes`.

- [ ] **Step 1: Add the campaigns permission area**

In `apps/api/src/lib/permissions.ts`, add to `PERMISSION_CATALOG` (e.g. after `bonuses`):

```ts
  { area: 'campaigns', label: 'Campaigns', permissions: [
    { key: 'campaigns.view', label: 'View campaigns' },
    { key: 'campaigns.manage', label: 'Create/edit campaigns' },
  ] },
```

- [ ] **Step 2: Write failing tests**

Create `apps/api/src/routes/admin/campaigns.test.ts` (mirror `bonuses.test.ts` mocks: authenticateAdmin, permissions.service all-allow, `@betting/db`). Cover: `GET /admin/campaigns` lists; `POST /admin/campaigns` creates (returns id); `POST` rejects a non-positive amount (400); `PUT /admin/campaigns/:id/status` updates. Use a valid UUID for :id.

- [ ] **Step 3: Run to verify fail** — `cd apps/api && npx vitest run src/routes/admin/campaigns.test.ts` (FAIL: 404).

- [ ] **Step 4: Implement the routes**

Create `apps/api/src/routes/admin/campaigns.ts`:

```ts
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { requirePermission } from '../../middleware/requirePermission.js'

async function audit(adminId: string, action: string, entityId: string | null, after: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO admin_audit_log (admin_id, action, entity, entity_id, after) VALUES ($1, $2, 'campaign', $3, $4::jsonb)`,
    [adminId, action, entityId, JSON.stringify(after ?? {})],
  )
}

const upsertBody = z.object({
  key: z.string().min(2).max(40).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers, underscores.'),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  type: z.enum(['welcome', 'custom']),
  amountCents: z.number().int().positive('Amount must be greater than zero.'),
  expiryDays: z.number().int().min(1).max(365).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
})

export async function adminCampaignRoutes(app: FastifyInstance) {
  app.get('/admin/campaigns', { preHandler: [authenticateAdmin, requirePermission('campaigns.view')] }, async (_req, reply) => {
    const { rows } = await pool.query(
      `SELECT c.id, c.key, c.name, c.description, c.type, c.amount_cents, c.expiry_days,
              c.starts_at, c.ends_at, c.status, c.created_at,
              (SELECT COUNT(*) FROM bonus_claims bc WHERE bc.campaign_id = c.id) AS claim_count
       FROM bonus_campaigns c ORDER BY c.created_at DESC LIMIT 200`,
    )
    return reply.send({ campaigns: rows })
  })

  app.post('/admin/campaigns', { preHandler: [authenticateAdmin, requirePermission('campaigns.manage')] }, async (req, reply) => {
    const parsed = upsertBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    const d = parsed.data
    try {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO bonus_campaigns (key, name, description, type, amount_cents, expiry_days, starts_at, ends_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [d.key, d.name, d.description ?? null, d.type, d.amountCents, d.expiryDays ?? 30, d.startsAt ?? null, d.endsAt ?? null, req.adminId],
      )
      await audit(req.adminId, 'campaign_create', rows[0].id, d)
      return reply.send({ id: rows[0].id })
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return reply.status(409).send({ error: { code: 'CAMPAIGN_KEY_TAKEN', message: 'That campaign key already exists.' } })
      throw err
    }
  })

  app.put('/admin/campaigns/:id', { preHandler: [authenticateAdmin, requirePermission('campaigns.manage')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = upsertBody.partial().safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    const d = parsed.data
    const { rowCount } = await pool.query(
      `UPDATE bonus_campaigns SET
         name = COALESCE($2, name), description = COALESCE($3, description),
         amount_cents = COALESCE($4, amount_cents), expiry_days = COALESCE($5, expiry_days),
         starts_at = COALESCE($6, starts_at), ends_at = COALESCE($7, ends_at)
       WHERE id = $1`,
      [id, d.name ?? null, d.description ?? null, d.amountCents ?? null, d.expiryDays ?? null, d.startsAt ?? null, d.endsAt ?? null],
    )
    if (!rowCount) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Campaign not found.' } })
    await audit(req.adminId, 'campaign_update', id, d)
    return reply.send({ ok: true })
  })

  app.put('/admin/campaigns/:id/status', { preHandler: [authenticateAdmin, requirePermission('campaigns.manage')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({ status: z.enum(['active', 'paused', 'ended']) }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid status.' } })
    const { rowCount } = await pool.query(`UPDATE bonus_campaigns SET status = $2 WHERE id = $1`, [id, parsed.data.status])
    if (!rowCount) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Campaign not found.' } })
    await audit(req.adminId, 'campaign_status', id, { status: parsed.data.status })
    return reply.send({ ok: true })
  })
}
```

- [ ] **Step 5: Register in server.ts** — import + `app.register(adminCampaignRoutes)`.

- [ ] **Step 6: Run tests + tsc** — `cd apps/api && npx vitest run src/routes/admin/campaigns.test.ts && npx vitest run && npx tsc --noEmit` (PASS).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/permissions.ts apps/api/src/routes/admin/campaigns.ts apps/api/src/routes/admin/campaigns.test.ts apps/api/src/server.ts
git commit -m "feat(api): admin campaign CRUD + campaigns.* permissions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Admin Campaigns tab

**Files:** Create `apps/admin/src/components/CampaignsTab.tsx`; Modify `apps/admin/src/app/dashboard/page.tsx`

- [ ] **Step 1: Write CampaignsTab**

Create `apps/admin/src/components/CampaignsTab.tsx` — a client component with a create form (key, name, description, type select welcome/custom, amount KES, expiry days, optional starts/ends datetime) POSTing to `/admin/campaigns`, and a table from `GET /admin/campaigns` (name, type, amount, expiry, window, status, claim count) with status controls (active/paused/ended via `PUT /admin/campaigns/:id/status`). Use `apiFetch` from `@/lib/api`, handle the `{data,error}` shape, reload after mutations, KES formatting `(cents/100)`. No em-dashes. Follow `BonusesTab.tsx` style/structure.

- [ ] **Step 2: Wire into dashboard**

In `apps/admin/src/app/dashboard/page.tsx`: import `CampaignsTab`; add `'campaigns'` to the `tab` union, `ALL_TABS`, and `TAB_PERMISSION` (`campaigns: 'campaigns.view'`); render `{tab === 'campaigns' && <CampaignsTab />}`. Read the file first and mirror how the Bonuses tab is wired.

- [ ] **Step 3: Typecheck** — `cd apps/admin && npx tsc --noEmit` (clean).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/components/CampaignsTab.tsx apps/admin/src/app/dashboard/page.tsx
git commit -m "feat(admin): Campaigns tab (CRUD + status)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Player Rewards page

**Files:** Create `apps/web/src/app/(player)/rewards/page.tsx`; Modify `apps/web/src/app/(player)/layout.tsx`

- [ ] **Step 1: Write the Rewards page**

Create `apps/web/src/app/(player)/rewards/page.tsx` — a client page that fetches `/bonuses/available` (via `@/lib/apiFetch`), lists campaigns with name/description/amount and a Claim button (disabled when `!claimable`), and on claim POSTs `/bonuses/claim` with `{ campaignId, deviceId: getDeviceId() }` (from `@/lib/device`). On success show the credited amount + refresh balance (`window.dispatchEvent(new Event('balanceRefresh'))`) and remove the campaign from the list; on error show the friendly `error.message` (covers NOT_ELIGIBLE / ALREADY_CLAIMED / ACTIVE_BONUS_EXISTS). No em-dashes. Match existing player page styling (game-card/border classes).

- [ ] **Step 2: Add the nav link**

In `apps/web/src/app/(player)/layout.tsx`, add to `navLinks` a Rewards entry (e.g. `{ href: '/rewards', label: 'Rewards', icon: <Gift size={18} />, match: p => p === '/rewards' }`), importing a `Gift` icon from lucide-react.

- [ ] **Step 3: Typecheck + compile smoke** — `cd apps/web && npx tsc --noEmit`; optionally `next dev` smoke of `/rewards` (200). Clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(player)/rewards/page.tsx" "apps/web/src/app/(player)/layout.tsx"
git commit -m "feat(web): Rewards page to claim campaign bonuses

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full verification + deploy

- [ ] **Step 1:** `cd apps/api && npx vitest run && npx tsc --noEmit` (all green).
- [ ] **Step 2:** `cd apps/admin && npx tsc --noEmit` and `cd apps/web && npx tsc --noEmit` (clean).
- [ ] **Step 3:** Push the branch; deploy API (`srv-d7eb279o3t8c73ebvvdg`, runs migration 039) then Admin (`srv-d7ee004vikkc73enkl40`) then Web (`srv-d7edvs57vvec73ep0shg`). Capture each deploy id (`grep -oE '"id":"dep-[^"]*"'`) and poll to `live`.
- [ ] **Step 4:** Prod smoke: `curl -s -o /dev/null -w '%{http_code}\n' https://wingubid-api.onrender.com/admin/campaigns` (401) and `.../bonuses/available` (401). Confirm the API log shows `applied 039_bonus_campaigns.sql`.
- [ ] **Step 5:** Manual walkthrough: admin -> Campaigns -> create a "welcome" campaign (active). New player -> Rewards -> Claim -> bonus balance rises; second claim -> already-claimed; a second account sharing device/IP -> not eligible.

---

## Self-Review Notes

- **Spec coverage:** campaigns + claims tables + grant campaign source (Task 1); grantBonus opts + eligibility broadening (Task 2); claim service + player routes with strict enforcement + claim signal (Task 3); permissions + admin CRUD (Task 4); admin UI (Task 5); player Rewards (Task 6); verify+deploy (Task 7). All spec sections map to a task.
- **Type consistency:** `grantBonus(..., grantedBy: string|null, expiresAt, opts)` consistent across Tasks 2-3; `claimCampaignBonus(playerId, campaignId, ip, deviceId)` consistent across Task 3; `campaigns.view/manage` consistent Tasks 4-5.
- **Safety:** claim signal capture is best-effort + IP-validated (never fails a claim); grant+claim atomic with the UNIQUE closing double-claim races; grantBonus defaults preserve Slice 1 admin grants; campaign grants use the global win cap (settlement unchanged).
