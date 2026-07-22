# Bonus Eligibility & Abuse Prevention (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture signup IP + device id, add a reusable bonus-eligibility engine that flags cross-account duplicates (device/IP/velocity) and prior bonuses, and wire it into the admin grant flow (block-severity needs an override; warn flags are shown + audited).

**Architecture:** A `player_signals` table records `signup` IP + opaque device id at registration. `evaluateBonusEligibility(playerId)` returns warn/block flags from that data + `bonus_grants`. The admin grant route previews and enforces it. Deterministic checks (active bonus) still hard-block; IP is never a blind block (Safaricom carrier NAT) — velocity auto-block is configurable and off by default.

**Tech Stack:** Fastify + `@betting/db` (raw SQL, pg pool), Zod, Vitest (API); Next.js 14 + Tailwind (admin + web). `req.ip` is trustworthy (trustProxy on).

## Global Constraints

- Migrations are plain SQL in `packages/db/migrations`, numbered `NNN_name.sql`; this is **038**.
- API error shape is always `{ error: { code, message } }`; use `AppError` from `apps/api/src/lib/errors.js`.
- IPs are stored for fraud prevention only, shown only to `bonuses.view` admins, never exposed to players or externally.
- Defaults (config `game_settings` key `bonus_abuse`): `ipVelocityFlag = 3`, `ipVelocityBlock = 0` (0 = auto-block disabled).
- A player never matches itself in any eligibility query.
- ESM imports keep `.js` extensions even for `.ts` files. No em-dashes in source or UI copy.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Tests: `cd apps/api && npx vitest run <path>`; typecheck `cd apps/api && npx tsc --noEmit`, `cd apps/admin && npx tsc --noEmit`, `cd apps/web && npx tsc --noEmit`.
- Existing register + bonus/grant behavior must stay green (new params are optional; players without signals produce no flags).

## File Structure

**API (create):**
- `packages/db/migrations/038_player_signals.sql`
- `apps/api/src/services/bonus-eligibility.service.ts` + `bonus-eligibility.service.test.ts`

**API (modify):**
- `apps/api/src/services/game-settings.service.ts` — `getBonusAbuseConfig()`.
- `apps/api/src/services/auth.service.ts` — `RegisterInput` gains `ip?`, `deviceId?`; insert a `signup` signal.
- `apps/api/src/routes/auth/register.ts` — body `deviceId?`; pass `req.ip`.
- `apps/api/src/routes/admin/bonuses.ts` (+ `bonuses.test.ts`) — eligibility preview + grant enforcement.

**Web (create):** `apps/web/src/lib/device.ts`
**Web (modify):** `apps/web/src/app/page.tsx` — send `deviceId` on register.
**Admin (modify):** `apps/admin/src/components/BonusesTab.tsx` — eligibility preview + flags + override.

---

## Task 1: Migration 038 — player_signals

**Files:**
- Create: `packages/db/migrations/038_player_signals.sql`

**Interfaces:**
- Produces table `player_signals(id, player_id, kind, ip, device_id, created_at)` with indexes on player_id, ip, device_id.

- [ ] **Step 1: Write the migration**

Create `packages/db/migrations/038_player_signals.sql`:

```sql
-- Fraud/abuse signals per player. Extensible via `kind` (Slice 3 adds 'claim').
CREATE TABLE IF NOT EXISTS player_signals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind       VARCHAR(12) NOT NULL CHECK (kind IN ('signup','login','claim')),
  ip         INET,
  device_id  VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_player_signals_player_id ON player_signals(player_id);
CREATE INDEX IF NOT EXISTS idx_player_signals_ip ON player_signals(ip) WHERE ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_player_signals_device ON player_signals(device_id) WHERE device_id IS NOT NULL;
```

- [ ] **Step 2: Typecheck the API**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/038_player_signals.sql
git commit -m "feat(db): player_signals table for abuse signals

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Config getter + eligibility engine

**Files:**
- Modify: `apps/api/src/services/game-settings.service.ts`
- Create: `apps/api/src/services/bonus-eligibility.service.ts`
- Test: `apps/api/src/services/bonus-eligibility.service.test.ts`

**Interfaces:**
- Produces:
  - `getBonusAbuseConfig(): Promise<{ ipVelocityFlag: number; ipVelocityBlock: number }>`
  - `type FlagType = 'prior_bonus' | 'device_bonus' | 'ip_bonus' | 'ip_velocity'`
  - `interface EligibilityFlag { type: FlagType; severity: 'warn' | 'block'; message: string; count?: number; matchedPlayerIds?: string[] }`
  - `evaluateBonusEligibility(playerId: string): Promise<{ flags: EligibilityFlag[] }>`

- [ ] **Step 1: Add the config getter**

In `apps/api/src/services/game-settings.service.ts`, add (mirror the existing JSONB getters):

```ts
const BONUS_ABUSE_KEY = 'bonus_abuse'
const DEFAULT_BONUS_ABUSE = { ipVelocityFlag: 3, ipVelocityBlock: 0 }

export async function getBonusAbuseConfig(): Promise<{ ipVelocityFlag: number; ipVelocityBlock: number }> {
  const { rows } = await pool.query<{ value: unknown }>(
    `SELECT value FROM game_settings WHERE key = $1`, [BONUS_ABUSE_KEY],
  )
  if (rows.length === 0) return { ...DEFAULT_BONUS_ABUSE }
  return { ...DEFAULT_BONUS_ABUSE, ...(rows[0].value as Partial<typeof DEFAULT_BONUS_ABUSE>) }
}
```

- [ ] **Step 2: Write failing tests**

Create `apps/api/src/services/bonus-eligibility.service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))
vi.mock('./game-settings.service.js', () => ({ getBonusAbuseConfig: vi.fn() }))

import { pool } from '@betting/db'
import { getBonusAbuseConfig } from './game-settings.service.js'
import { evaluateBonusEligibility } from './bonus-eligibility.service.js'

const mockQuery = vi.mocked(pool.query)
const mockCfg = vi.mocked(getBonusAbuseConfig)

// The engine runs 4 queries in order: prior_bonus, device_bonus, ip_bonus, velocity.
function seed(prior: unknown[], device: unknown[], ip: unknown[], velocity: number) {
  mockQuery.mockReset()
  mockQuery
    .mockResolvedValueOnce({ rows: prior } as never)
    .mockResolvedValueOnce({ rows: device } as never)
    .mockResolvedValueOnce({ rows: ip } as never)
    .mockResolvedValueOnce({ rows: [{ n: String(velocity) }] } as never)
}

beforeEach(() => { mockCfg.mockResolvedValue({ ipVelocityFlag: 3, ipVelocityBlock: 0 }) })

describe('evaluateBonusEligibility', () => {
  it('returns no flags for a clean player', async () => {
    seed([], [], [], 1)
    const { flags } = await evaluateBonusEligibility('p1')
    expect(flags).toHaveLength(0)
  })

  it('flags prior_bonus when the player already has a grant', async () => {
    seed([{ x: 1 }], [], [], 1)
    const { flags } = await evaluateBonusEligibility('p1')
    expect(flags.find(f => f.type === 'prior_bonus')?.severity).toBe('warn')
  })

  it('flags device_bonus and ip_bonus with matched ids', async () => {
    seed([], [{ player_id: 'p2' }], [{ player_id: 'p3' }], 1)
    const { flags } = await evaluateBonusEligibility('p1')
    const dev = flags.find(f => f.type === 'device_bonus')
    expect(dev?.matchedPlayerIds).toEqual(['p2'])
    expect(flags.find(f => f.type === 'ip_bonus')?.count).toBe(1)
  })

  it('warns on ip_velocity at the flag threshold', async () => {
    seed([], [], [], 3)
    const { flags } = await evaluateBonusEligibility('p1')
    expect(flags.find(f => f.type === 'ip_velocity')?.severity).toBe('warn')
  })

  it('blocks on ip_velocity when block threshold is set and met', async () => {
    mockCfg.mockResolvedValue({ ipVelocityFlag: 3, ipVelocityBlock: 5 })
    seed([], [], [], 5)
    const { flags } = await evaluateBonusEligibility('p1')
    expect(flags.find(f => f.type === 'ip_velocity')?.severity).toBe('block')
  })
})
```

- [ ] **Step 3: Run to verify fail**

Run: `cd apps/api && npx vitest run src/services/bonus-eligibility.service.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the engine**

Create `apps/api/src/services/bonus-eligibility.service.ts`:

```ts
import { pool } from '@betting/db'
import { getBonusAbuseConfig } from './game-settings.service.js'

export type FlagType = 'prior_bonus' | 'device_bonus' | 'ip_bonus' | 'ip_velocity'

export interface EligibilityFlag {
  type: FlagType
  severity: 'warn' | 'block'
  message: string
  count?: number
  matchedPlayerIds?: string[]
}

// Cross-account duplicate signals for a bonus. Never blocks on its own except an
// (off-by-default) IP-velocity auto-block; the caller decides what to do.
export async function evaluateBonusEligibility(playerId: string): Promise<{ flags: EligibilityFlag[] }> {
  const cfg = await getBonusAbuseConfig()
  const flags: EligibilityFlag[] = []

  const { rows: prior } = await pool.query(
    `SELECT 1 FROM bonus_grants WHERE player_id = $1 LIMIT 1`, [playerId],
  )
  if (prior.length > 0) {
    flags.push({ type: 'prior_bonus', severity: 'warn', message: 'This player has already received a bonus.' })
  }

  // Other accounts on the same device that already received a bonus.
  const { rows: dev } = await pool.query<{ player_id: string }>(
    `SELECT DISTINCT ps.player_id
     FROM player_signals ps
     JOIN bonus_grants bg ON bg.player_id = ps.player_id
     WHERE ps.player_id <> $1
       AND ps.device_id IN (
         SELECT device_id FROM player_signals
         WHERE player_id = $1 AND kind = 'signup' AND device_id IS NOT NULL)`,
    [playerId],
  )
  if (dev.length > 0) {
    flags.push({ type: 'device_bonus', severity: 'warn', count: dev.length,
      matchedPlayerIds: dev.map(r => r.player_id),
      message: `${dev.length} other account(s) on this device already received a bonus.` })
  }

  // Other accounts on the same signup IP that already received a bonus (household).
  const { rows: ipb } = await pool.query<{ player_id: string }>(
    `SELECT DISTINCT ps.player_id
     FROM player_signals ps
     JOIN bonus_grants bg ON bg.player_id = ps.player_id
     WHERE ps.player_id <> $1
       AND ps.ip IN (
         SELECT ip FROM player_signals
         WHERE player_id = $1 AND kind = 'signup' AND ip IS NOT NULL)`,
    [playerId],
  )
  if (ipb.length > 0) {
    flags.push({ type: 'ip_bonus', severity: 'warn', count: ipb.length,
      matchedPlayerIds: ipb.map(r => r.player_id),
      message: `${ipb.length} other account(s) on this IP already received a bonus.` })
  }

  // Distinct accounts sharing this player's signup IP(s) (includes this player).
  const { rows: vel } = await pool.query<{ n: string }>(
    `SELECT COUNT(DISTINCT player_id) AS n
     FROM player_signals
     WHERE kind = 'signup'
       AND ip IN (
         SELECT ip FROM player_signals
         WHERE player_id = $1 AND kind = 'signup' AND ip IS NOT NULL)`,
    [playerId],
  )
  const n = Number(vel[0].n)
  if (cfg.ipVelocityBlock > 0 && n >= cfg.ipVelocityBlock) {
    flags.push({ type: 'ip_velocity', severity: 'block', count: n,
      message: `${n} accounts share this IP (auto-block threshold reached).` })
  } else if (n >= cfg.ipVelocityFlag) {
    flags.push({ type: 'ip_velocity', severity: 'warn', count: n,
      message: `${n} accounts share this IP.` })
  }

  return { flags }
}
```

- [ ] **Step 5: Run to verify pass + tsc**

Run: `cd apps/api && npx vitest run src/services/bonus-eligibility.service.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/bonus-eligibility.service.ts apps/api/src/services/bonus-eligibility.service.test.ts apps/api/src/services/game-settings.service.ts
git commit -m "feat(api): bonus eligibility engine + abuse config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Capture signup IP + device at registration

**Files:**
- Modify: `apps/api/src/services/auth.service.ts`
- Modify: `apps/api/src/routes/auth/register.ts`
- Test: `apps/api/src/routes/auth/register.test.ts` (create if absent) or `apps/api/src/services/auth.service.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `RegisterInput` gains `ip?: string; deviceId?: string`; a `player_signals` `signup` row per registration.

- [ ] **Step 1: Add ip/deviceId to RegisterInput + insert the signal**

In `apps/api/src/services/auth.service.ts`:
- Extend the interface:

```ts
export interface RegisterInput {
  phone: string
  name: string
  country: string
  currency: string
  date_of_birth: string
  password: string
  ip?: string
  deviceId?: string
}
```

- Inside `registerPlayer`, after the wallet insert and the DEMO_MODE balance block, still within the transaction (before `await client.query('COMMIT')`), add:

```ts
    // Abuse signal: record the signup IP + device for later bonus eligibility
    // checks. Best-effort; only write when we actually have something.
    if (input.ip || input.deviceId) {
      await client.query(
        `INSERT INTO player_signals (player_id, kind, ip, device_id)
         VALUES ($1, 'signup', $2, $3)`,
        [playerId, input.ip ?? null, input.deviceId ? input.deviceId.slice(0, 64) : null],
      )
    }
```

- [ ] **Step 2: Pass ip + deviceId from the route**

In `apps/api/src/routes/auth/register.ts`:
- Add to the body schema: `deviceId: z.string().max(64).optional(),`
- Change the call to include ip + deviceId:

```ts
      const tokens = await registerPlayer({
        ...parsed.data,
        currency: currencyMap[country],
        ip: req.ip,
        deviceId: parsed.data.deviceId,
      })
```

- [ ] **Step 3: Write/adjust a test**

If `apps/api/src/services/auth.service.test.ts` exists, add a case asserting a signup writes a `player_signals` row (mock the client's `query`, assert an INSERT into `player_signals` with the ip + deviceId was issued). Otherwise create `apps/api/src/routes/auth/register.test.ts` using `buildServer()` + `app.inject()` with `@betting/db` mocked, asserting a register call issues an `INSERT INTO player_signals` and returns 201. Read the existing auth test setup first and mirror its mock shape (SMS config, otp, hash).

- [ ] **Step 4: Run tests + tsc**

Run: `cd apps/api && npx vitest run && npx tsc --noEmit`
Expected: full suite green (existing register tests still pass since ip/deviceId are optional).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/auth.service.ts apps/api/src/routes/auth/register.ts apps/api/src/routes/auth/register.test.ts apps/api/src/services/auth.service.test.ts
git commit -m "feat(api): capture signup IP + device id as abuse signals

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Web — device id sent on registration

**Files:**
- Create: `apps/web/src/lib/device.ts`
- Modify: `apps/web/src/app/page.tsx`

**Interfaces:**
- Produces: `getDeviceId(): string`.

- [ ] **Step 1: Write the device-id util**

Create `apps/web/src/lib/device.ts`:

```ts
// A stable, opaque first-party device id kept in localStorage. Not PII; used as
// one signal for bonus abuse prevention. Resets if the user clears storage.
const KEY = 'wb_device_id'

export function getDeviceId(): string {
  if (typeof window === 'undefined') return ''
  try {
    let id = window.localStorage.getItem(KEY)
    if (!id) {
      id = crypto.randomUUID()
      window.localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return ''
  }
}
```

- [ ] **Step 2: Send deviceId on register**

In `apps/web/src/app/page.tsx`:
- Import: `import { getDeviceId } from '@/lib/device'`
- Add `deviceId` to the register body:

```ts
      body: JSON.stringify({ phone: check.e164, name, country: 'KE', date_of_birth: dob, password, deviceId: getDeviceId() }),
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/device.ts apps/web/src/app/page.tsx
git commit -m "feat(web): send opaque device id on registration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Admin — eligibility preview + grant enforcement

**Files:**
- Modify: `apps/api/src/routes/admin/bonuses.ts`
- Test: `apps/api/src/routes/admin/bonuses.test.ts`

**Interfaces:**
- Consumes: `evaluateBonusEligibility` from `../../services/bonus-eligibility.service.js`.
- Produces: `GET /admin/bonuses/eligibility`; `POST /admin/bonuses/grant` gains `override?: boolean` + block enforcement + flag auditing.

- [ ] **Step 1: Write failing tests**

Add to `apps/api/src/routes/admin/bonuses.test.ts` (the file mocks `authenticateAdmin`, `permissions.service`, `@betting/db`, `game-settings.service`). Add a mock for the eligibility service and cases:

```ts
vi.mock('../../services/bonus-eligibility.service.js', () => ({
  evaluateBonusEligibility: vi.fn(async () => ({ flags: [] })),
}))
```
(place with the other `vi.mock` calls, and import `evaluateBonusEligibility` where needed)

```ts
import { evaluateBonusEligibility } from '../../services/bonus-eligibility.service.js'

describe('GET /admin/bonuses/eligibility', () => {
  const app = buildServer(); afterAll(() => app.close())
  it('returns flags for a player looked up by phone', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PLAYER_ID }] } as never) // player by phone
    vi.mocked(evaluateBonusEligibility).mockResolvedValueOnce({ flags: [{ type: 'ip_velocity', severity: 'warn', message: '3 accounts share this IP.', count: 3 }] })
    const res = await app.inject({ method: 'GET', url: '/admin/bonuses/eligibility?phone=%2B254700000001', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().flags[0].type).toBe('ip_velocity')
  })
})

describe('POST /admin/bonuses/grant abuse enforcement', () => {
  const app = buildServer(); afterAll(() => app.close())
  it('blocks 409 ABUSE_BLOCKED on a block flag without override', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PLAYER_ID }] } as never) // player exists
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)                    // no active grant
    vi.mocked(evaluateBonusEligibility).mockResolvedValueOnce({ flags: [{ type: 'ip_velocity', severity: 'block', message: 'blocked', count: 9 }] })
    const res = await app.inject({ method: 'POST', url: '/admin/bonuses/grant', headers: { Authorization: 'Bearer t' },
      payload: { phone: '+254700000001', amountCents: 50000 } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('ABUSE_BLOCKED')
  })

  it('allows the grant with override:true despite a block flag', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PLAYER_ID }] } as never) // player exists
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)                    // no active grant
    vi.mocked(evaluateBonusEligibility).mockResolvedValueOnce({ flags: [{ type: 'ip_velocity', severity: 'block', message: 'blocked', count: 9 }] })
    mockConnect.mockResolvedValueOnce(fakeClient((sql) => {
      if (sql.includes('SELECT id, balance')) return { rows: [{ id: 'w1', balance: '0', currency: 'KES' }] }
      if (sql.includes('INSERT INTO bonus_grants')) return { rows: [{ id: 'g9' }] }
      if (sql.startsWith('UPDATE wallets')) return { rows: [{ bonus_balance: '50000' }] }
      return { rows: [] }
    }) as never)
    const res = await app.inject({ method: 'POST', url: '/admin/bonuses/grant', headers: { Authorization: 'Bearer t' },
      payload: { phone: '+254700000001', amountCents: 50000, override: true } })
    expect(res.statusCode).toBe(200)
    expect(res.json().grantId).toBe('g9')
  })
})
```

> Note: the existing grant tests set `evaluateBonusEligibility` to return `{ flags: [] }` by default (the module mock), so they keep passing.

- [ ] **Step 2: Run to verify fail**

Run: `cd apps/api && npx vitest run src/routes/admin/bonuses.test.ts`
Expected: FAIL (eligibility route 404 / ABUSE_BLOCKED not implemented).

- [ ] **Step 3: Implement**

In `apps/api/src/routes/admin/bonuses.ts`:
- Import: `import { evaluateBonusEligibility } from '../../services/bonus-eligibility.service.js'`
- Add the preview route (before or after the list route), gated `bonuses.view`:

```ts
  app.get('/admin/bonuses/eligibility', { preHandler: [authenticateAdmin, requirePermission('bonuses.view')] }, async (req, reply) => {
    const q = req.query as { phone?: string; playerId?: string }
    const { rows } = q.playerId
      ? await pool.query<{ id: string }>(`SELECT id FROM players WHERE id = $1`, [q.playerId])
      : await pool.query<{ id: string }>(`SELECT id FROM players WHERE phone = $1`, [(q.phone ?? '').trim()])
    if (rows.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No player found with that phone number.' } })
    const { flags } = await evaluateBonusEligibility(rows[0].id)
    return reply.send({ playerId: rows[0].id, flags })
  })
```

- In `POST /admin/bonuses/grant`: add `override: z.boolean().optional()` to the body schema. After the existing active-bonus check and before computing `expiresAt`, add:

```ts
    const { flags } = await evaluateBonusEligibility(playerId)
    const blocked = flags.find(f => f.severity === 'block')
    if (blocked && parsed.data.override !== true) {
      return reply.status(409).send({ error: { code: 'ABUSE_BLOCKED', message: blocked.message }, flags })
    }
```

- Include the flags + override in the audit payload:

```ts
      await audit(req.adminId, 'bonus_grant', grantId, { playerId, amountCents: parsed.data.amountCents, expiresAt, flags, override: parsed.data.override === true })
```

- [ ] **Step 4: Run tests + full suite + tsc**

Run: `cd apps/api && npx vitest run src/routes/admin/bonuses.test.ts && npx vitest run && npx tsc --noEmit`
Expected: PASS, full suite green, clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/bonuses.ts apps/api/src/routes/admin/bonuses.test.ts
git commit -m "feat(api): bonus eligibility preview + grant abuse enforcement

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Admin Bonuses tab — eligibility preview + override

**Files:**
- Modify: `apps/admin/src/components/BonusesTab.tsx`

**Interfaces:**
- Consumes: `GET /admin/bonuses/eligibility`, `POST /admin/bonuses/grant` (with `override`).

- [ ] **Step 1: Add eligibility preview + flags + override to the grant form**

In `apps/admin/src/components/BonusesTab.tsx`:
- Add types + state near the existing form state:

```tsx
interface Flag { type: string; severity: 'warn' | 'block'; message: string; count?: number }
```
```tsx
  const [flags, setFlags] = useState<Flag[]>([])
  const [override, setOverride] = useState(false)
  const hasBlock = flags.some(f => f.severity === 'block')
```

- Add a checker that runs when the phone field loses focus:

```tsx
  async function checkEligibility() {
    setFlags([]); setOverride(false)
    const phone = form.phone.trim()
    if (!phone) return
    const { data } = await apiFetch<{ flags: Flag[] }>(`/admin/bonuses/eligibility?phone=${encodeURIComponent(phone)}`)
    if (data) setFlags(data.flags)
  }
```

- Wire `onBlur={checkEligibility}` on the phone `<input>`.
- In `grant`, include `override` when there is a block, and reset flags on success:

```tsx
    const body: Record<string, unknown> = { phone: form.phone.trim(), amountCents: Math.round(parseFloat(form.amount) * 100) }
    if (form.expiresInDays) body.expiresInDays = parseInt(form.expiresInDays)
    if (override) body.override = true
```
and after a successful grant also `setFlags([]); setOverride(false)`.

- Render the flags below the phone input (amber for warn, red for block) and, when `hasBlock`, an override checkbox; disable the submit button while `hasBlock && !override`:

```tsx
        {flags.length > 0 && (
          <div className="space-y-1">
            {flags.map((f, i) => (
              <p key={i} className={`text-xs ${f.severity === 'block' ? 'text-red-400' : 'text-amber-400'}`}>
                {f.severity === 'block' ? 'BLOCK' : 'FLAG'}: {f.message}
              </p>
            ))}
            {hasBlock && (
              <label className="flex items-center gap-2 text-xs text-red-300">
                <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} />
                Override and grant anyway
              </label>
            )}
          </div>
        )}
```
and on the submit button add `disabled={busy || (hasBlock && !override)}`.

- [ ] **Step 2: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/components/BonusesTab.tsx
git commit -m "feat(admin): show bonus eligibility flags + override on grant

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full verification + deploy

**Files:** none.

- [ ] **Step 1: Full API suite + typecheck**

Run: `cd apps/api && npx vitest run && npx tsc --noEmit`
Expected: all pass (existing register + grant tests green).

- [ ] **Step 2: Admin + web typecheck**

Run: `cd apps/admin && npx tsc --noEmit` and `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Push + deploy API, then Admin, then Web**

```bash
git push origin <branch>
```

Deploy via `RENDER_API_KEY` from `.env`: API (`srv-d7eb279o3t8c73ebvvdg`) first (migration 038 runs on boot), then Admin (`srv-d7ee004vikkc73enkl40`), then Web (`srv-d7edvs57vvec73ep0shg`). Capture each deploy id (`grep -oE '"id":"dep-[^"]*"'`) and poll to `live`.

- [ ] **Step 4: Prod smoke**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://wingubid-api.onrender.com/admin/bonuses/eligibility   # expect 401
```

Confirm the API deploy log shows `applied 038_player_signals.sql`.

- [ ] **Step 5: Manual walkthrough (owner)**

Register a new player (a signup signal is stored). In admin -> Bonuses, enter that player's phone: eligibility flags (if any) show. Grant works; with a forced block (temporarily set `ipVelocityBlock` low, or many accounts on one IP), the grant is blocked until "Override" is ticked. Confirm IPs are only visible to `bonuses.view` admins.

---

## Self-Review Notes

- **Spec coverage:** player_signals table (Task 1); config + engine with prior/device/ip/velocity flags (Task 2); signup IP+device capture (Tasks 3-4); preview endpoint + grant block/override + audit (Task 5); admin UI flags + override (Task 6); verify+deploy (Task 7). All spec sections map to a task.
- **Type consistency:** `evaluateBonusEligibility` / `EligibilityFlag` / `getBonusAbuseConfig` names consistent across Tasks 2 and 5; `deviceId`/`ip` param names consistent across Tasks 3-4; `override` consistent across Tasks 5-6.
- **Safe defaults:** `ipVelocityBlock = 0` means nothing auto-blocks until configured; warn flags never block; players without signals produce no flags, so existing flows are unaffected.
