# Staff Management + Roles & Permissions (RBAC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a super admin (or anyone granted the right permission) create staff, assign editable roles, and control fine-grained permissions from the admin UI — with a real-but-dormant LDAP bind module ready to enable later.

**Architecture:** Postgres gains `roles` + `role_permissions` tables; the permission *catalog* is code-defined (source of truth). A `requirePermission(key)` Fastify preHandler enforces access using a cached per-admin permission set. Authentication is refactored behind `authenticateStaff()` so a fully-implemented `ldapts` bind module can be switched on by config later. The admin app gets a Staff tab, permission-driven tab visibility, and a forced-password-change flow.

**Tech Stack:** Fastify + `@betting/db` (raw SQL, pg pool), Zod, bcryptjs, jsonwebtoken, `ldapts` (new), Vitest; Next.js 14 (admin app), Tailwind, `apiFetch`.

## Global Constraints

- Monorepo is pnpm; API is `apps/api`, admin app is `apps/admin`, migrations live in `packages/db/migrations` and run on API boot via `runMigrations()` in filename order.
- Migrations are plain SQL, numbered `NNN_name.sql`; next number is **036**.
- API error shape is always `{ error: { code, message } }`; use `AppError(code, message, statusCode)` from `apps/api/src/lib/errors.js` for user-safe errors.
- Password hashing: `hashPassword` / `verifyPassword` from `apps/api/src/lib/hash.js` (bcryptjs).
- Admin JWT: `signAdminAccessToken(adminId, roleKey)` / `verifyAdminAccessToken` — **shape stays `{ sub, role, type:'admin_access' }`**; do not change it.
- No em-dashes anywhere in source/UI copy (project rule).
- Money is integer cents; not relevant here but keep the convention if touched.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Tests: `cd apps/api && npx vitest run <path>`; typecheck: `cd apps/api && npx tsc --noEmit`, `cd apps/admin && npx tsc --noEmit`.
- `super_admin` role is all-access (every catalog key, including future ones) and is locked: its permissions cannot be edited and it cannot be deleted.
- Guardrail everywhere: never allow the last **active** `super_admin` to be suspended, demoted, or deleted.

## File Structure

**API (create):**
- `packages/db/migrations/036_staff_rbac.sql` — tables, seed roles + minimal grants, admin_users alters, backfill.
- `apps/api/src/lib/permissions.ts` — permission catalog + helpers.
- `apps/api/src/lib/permissions.test.ts`
- `apps/api/src/lib/ldap-auth.ts` — real `ldapts` bind module (dormant).
- `apps/api/src/lib/ldap-auth.test.ts`
- `apps/api/src/services/permissions.service.ts` — cached `getPermissionsForAdmin` + invalidation.
- `apps/api/src/services/permissions.service.test.ts`
- `apps/api/src/services/ldap-config.service.ts` — get/set `ldap_config` in `game_settings`.
- `apps/api/src/services/staff-auth.service.ts` — `authenticateStaff` (local + ldap seam).
- `apps/api/src/services/staff-auth.service.test.ts`
- `apps/api/src/middleware/requirePermission.ts`
- `apps/api/src/middleware/requirePermission.test.ts`
- `apps/api/src/routes/admin/staff.ts` + `staff.test.ts`
- `apps/api/src/routes/admin/roles.ts` + `roles.test.ts`
- `apps/api/src/routes/admin/me.ts` + `me.test.ts`

**API (modify):**
- `apps/api/package.json` — add `ldapts`.
- `apps/api/src/services/admin-auth.service.ts` — refactor `loginAdmin` to use `authenticateStaff`, stamp `last_login_at`, return `mustChangePassword`.
- `apps/api/src/routes/admin/auth.ts` — include `mustChangePassword` in login response.
- `apps/api/src/routes/admin/chat.ts` — retrofit `requireMod` -> `requirePermission`.
- `apps/api/src/routes/admin/withdrawals.ts` — retrofit `requireApprover` -> `requirePermission`.
- `apps/api/src/routes/admin/chat.test.ts` (if present) / `withdrawals` tests — mock permissions service.
- `apps/api/src/server.ts` — register new route modules.

**Admin app (create):**
- `apps/admin/src/lib/me.ts` — `Me` type + `fetchMe()`.
- `apps/admin/src/app/change-password/page.tsx`
- `apps/admin/src/components/StaffTab.tsx`

**Admin app (modify):**
- `apps/admin/src/app/login/page.tsx` — route to `/change-password` when `mustChangePassword`.
- `apps/admin/src/app/dashboard/page.tsx` — permission-driven tab visibility + Staff tab.

---

## Task 1: Migration 036 — RBAC schema, seed, backfill

**Files:**
- Create: `packages/db/migrations/036_staff_rbac.sql`

**Interfaces:**
- Produces: tables `roles(id,key,name,description,is_system,created_at)`, `role_permissions(role_id,permission_key)`; new `admin_users` columns `role_id, auth_provider, must_change_password, created_by, last_login_at`. Seeded role keys: `super_admin, finance, risk, support, reports`.

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/migrations/036_staff_rbac.sql`:

```sql
-- Roles + fine-grained permissions (RBAC) for admin staff.

CREATE TABLE IF NOT EXISTS roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         VARCHAR(40) UNIQUE NOT NULL,
  name        VARCHAR(80) NOT NULL,
  description VARCHAR(255),
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key VARCHAR(60) NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

-- The role column was a fixed 4-value enum; drop that CHECK so it can hold any
-- role key (custom roles included). It stays as a denormalized cache of the
-- assigned role's key, kept in sync by the app on assignment.
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id),
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(10) NOT NULL DEFAULT 'local'
    CHECK (auth_provider IN ('local','ldap')),
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES admin_users(id),
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Seed roles (idempotent). super_admin is all-access in code; no rows needed
-- for it in role_permissions. 'reports' kept for back-compat with any legacy
-- admin_users.role = 'reports'.
INSERT INTO roles (key, name, description, is_system) VALUES
  ('super_admin', 'Super Admin', 'Full access to everything.', true),
  ('finance',     'Finance',     'Money operations.',          true),
  ('risk',        'Risk',        'Game integrity and abuse.',  true),
  ('support',     'Support',     'Customer support.',          true),
  ('reports',     'Reports',     'Read-only reporting.',       true)
ON CONFLICT (key) DO NOTHING;

-- Minimal default grants: each role gets stats.view + its own area's view.
-- Super admin configures the rest in the UI.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM roles r
JOIN (VALUES
  ('finance','stats.view'), ('finance','withdrawals.view'), ('finance','transactions.view'),
  ('risk','stats.view'),    ('risk','settings.view'),       ('risk','chat.view'),
  ('support','stats.view'), ('support','players.view'),     ('support','chat.view'),
  ('reports','stats.view')
) AS p(role_key, key) ON p.role_key = r.key
ON CONFLICT (role_id, permission_key) DO NOTHING;

-- Backfill role_id from the existing denormalized role key.
UPDATE admin_users au
SET role_id = r.id
FROM roles r
WHERE r.key = au.role AND au.role_id IS NULL;
```

- [ ] **Step 2: Typecheck the API (SQL is read at runtime; ensure nothing else broke)**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify the migration applies on boot (if a local DB is reachable)**

If `DATABASE_URL` points at a local/dev DB, run: `cd apps/api && npx tsx src/index.ts` and watch for the migration log line `applied 036_staff_rbac.sql`, then Ctrl-C. If no local DB is available, note that verification happens at deploy (migrations run on API boot) and continue.

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/036_staff_rbac.sql
git commit -m "feat(db): RBAC roles + role_permissions + admin_users staff columns

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Permission catalog

**Files:**
- Create: `apps/api/src/lib/permissions.ts`
- Test: `apps/api/src/lib/permissions.test.ts`

**Interfaces:**
- Produces:
  - `interface PermissionGroup { area: string; label: string; permissions: { key: string; label: string }[] }`
  - `const PERMISSION_CATALOG: PermissionGroup[]`
  - `const ALL_PERMISSION_KEYS: string[]`
  - `function isValidPermission(key: string): boolean`
  - `const SUPER_ADMIN_ROLE_KEY = 'super_admin'`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/permissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PERMISSION_CATALOG, ALL_PERMISSION_KEYS, isValidPermission, SUPER_ADMIN_ROLE_KEY } from './permissions.js'

describe('permission catalog', () => {
  it('exposes grouped areas with at least staff and roles', () => {
    const areas = PERMISSION_CATALOG.map(g => g.area)
    expect(areas).toContain('staff')
    expect(areas).toContain('roles')
    expect(areas).toContain('withdrawals')
  })

  it('ALL_PERMISSION_KEYS is the flattened, unique set of every key', () => {
    const flat = PERMISSION_CATALOG.flatMap(g => g.permissions.map(p => p.key))
    expect(ALL_PERMISSION_KEYS).toEqual(flat)
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length)
  })

  it('validates keys against the catalog', () => {
    expect(isValidPermission('withdrawals.approve')).toBe(true)
    expect(isValidPermission('not.a.key')).toBe(false)
  })

  it('exports the super admin role key', () => {
    expect(SUPER_ADMIN_ROLE_KEY).toBe('super_admin')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/lib/permissions.test.ts`
Expected: FAIL (cannot find module `./permissions.js`).

- [ ] **Step 3: Write the catalog**

Create `apps/api/src/lib/permissions.ts`:

```ts
export interface PermissionGroup {
  area: string
  label: string
  permissions: { key: string; label: string }[]
}

export const SUPER_ADMIN_ROLE_KEY = 'super_admin'

export const PERMISSION_CATALOG: PermissionGroup[] = [
  { area: 'stats', label: 'Dashboard', permissions: [
    { key: 'stats.view', label: 'View dashboard stats' },
  ] },
  { area: 'players', label: 'Players', permissions: [
    { key: 'players.view', label: 'View players' },
    { key: 'players.edit', label: 'Edit players' },
    { key: 'players.suspend', label: 'Suspend players' },
    { key: 'players.adjust_balance', label: 'Adjust balances' },
    { key: 'players.export', label: 'Export players' },
  ] },
  { area: 'transactions', label: 'Transactions', permissions: [
    { key: 'transactions.view', label: 'View transactions' },
    { key: 'transactions.export', label: 'Export transactions' },
    { key: 'transactions.dispute', label: 'Dispute transactions' },
  ] },
  { area: 'withdrawals', label: 'Withdrawals', permissions: [
    { key: 'withdrawals.view', label: 'View withdrawals' },
    { key: 'withdrawals.approve', label: 'Approve withdrawals' },
    { key: 'withdrawals.reject', label: 'Reject withdrawals' },
    { key: 'withdrawals.config', label: 'Configure approval threshold' },
  ] },
  { area: 'reconciliation', label: 'Reconciliation', permissions: [
    { key: 'reconciliation.view', label: 'View paybill reconciliation' },
    { key: 'reconciliation.resolve', label: 'Resolve paybill payments' },
  ] },
  { area: 'payments', label: 'Payments', permissions: [
    { key: 'payments.view', label: 'View payment config' },
    { key: 'payments.edit', label: 'Edit payment config' },
  ] },
  { area: 'integrations', label: 'Integrations', permissions: [
    { key: 'integrations.view', label: 'View integrations' },
    { key: 'integrations.edit', label: 'Edit integrations' },
  ] },
  { area: 'promotions', label: 'Promotions', permissions: [
    { key: 'promotions.view', label: 'View banners' },
    { key: 'promotions.create', label: 'Create banners' },
    { key: 'promotions.edit', label: 'Edit banners' },
    { key: 'promotions.delete', label: 'Delete banners' },
    { key: 'promotions.activate', label: 'Activate banners' },
  ] },
  { area: 'chat', label: 'Chat', permissions: [
    { key: 'chat.view', label: 'View chat' },
    { key: 'chat.moderate', label: 'Moderate (delete, ban, mute)' },
    { key: 'chat.config', label: 'Enable/disable + autoban config' },
    { key: 'chat.words', label: 'Manage banned words' },
    { key: 'chat.reset_username', label: 'Reset usernames' },
  ] },
  { area: 'settings', label: 'Game Settings', permissions: [
    { key: 'settings.view', label: 'View game settings' },
    { key: 'settings.edit', label: 'Edit game settings' },
  ] },
  { area: 'staff', label: 'Staff', permissions: [
    { key: 'staff.view', label: 'View staff' },
    { key: 'staff.create', label: 'Create staff' },
    { key: 'staff.edit', label: 'Edit staff' },
    { key: 'staff.suspend', label: 'Suspend/activate staff' },
    { key: 'staff.reset_password', label: 'Reset staff passwords' },
  ] },
  { area: 'roles', label: 'Roles', permissions: [
    { key: 'roles.view', label: 'View roles' },
    { key: 'roles.create', label: 'Create roles' },
    { key: 'roles.edit', label: 'Edit roles' },
    { key: 'roles.delete', label: 'Delete roles' },
  ] },
]

export const ALL_PERMISSION_KEYS: string[] =
  PERMISSION_CATALOG.flatMap(g => g.permissions.map(p => p.key))

const KEY_SET = new Set(ALL_PERMISSION_KEYS)

export function isValidPermission(key: string): boolean {
  return KEY_SET.has(key)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/lib/permissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/permissions.ts apps/api/src/lib/permissions.test.ts
git commit -m "feat(api): fine-grained permission catalog

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Permissions service (cached per-admin lookup)

**Files:**
- Create: `apps/api/src/services/permissions.service.ts`
- Test: `apps/api/src/services/permissions.service.test.ts`

**Interfaces:**
- Consumes: `pool` from `@betting/db`; `ALL_PERMISSION_KEYS`, `SUPER_ADMIN_ROLE_KEY` from `../lib/permissions.js`.
- Produces:
  - `async function getPermissionsForAdmin(adminId: string): Promise<Set<string>>`
  - `function invalidatePermissionsCache(): void`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/permissions.service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@betting/db'
import { getPermissionsForAdmin, invalidatePermissionsCache } from './permissions.service.js'
import { ALL_PERMISSION_KEYS } from '../lib/permissions.js'

const mockQuery = vi.mocked(pool.query)

describe('getPermissionsForAdmin', () => {
  beforeEach(() => { mockQuery.mockReset(); invalidatePermissionsCache() })

  it('returns the role grants for a normal role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role_key: 'finance', perms: ['stats.view', 'withdrawals.view'] }] } as never)
    const set = await getPermissionsForAdmin('a1')
    expect(set.has('stats.view')).toBe(true)
    expect(set.has('withdrawals.approve')).toBe(false)
  })

  it('gives super_admin every catalog key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role_key: 'super_admin', perms: [] }] } as never)
    const set = await getPermissionsForAdmin('a2')
    for (const k of ALL_PERMISSION_KEYS) expect(set.has(k)).toBe(true)
  })

  it('caches: a second call within TTL does not re-query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role_key: 'support', perms: ['stats.view'] }] } as never)
    await getPermissionsForAdmin('a3')
    await getPermissionsForAdmin('a3')
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('returns an empty set when the admin has no role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const set = await getPermissionsForAdmin('a4')
    expect(set.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/services/permissions.service.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the service**

Create `apps/api/src/services/permissions.service.ts`:

```ts
import { pool } from '@betting/db'
import { ALL_PERMISSION_KEYS, SUPER_ADMIN_ROLE_KEY } from '../lib/permissions.js'

const TTL_MS = 30_000
const cache = new Map<string, { perms: Set<string>; at: number }>()

// Effective permission keys for an admin, resolved from their assigned role.
// super_admin resolves to every catalog key (including ones added later).
// Cached briefly per admin; invalidated wholesale on any role change.
export async function getPermissionsForAdmin(adminId: string): Promise<Set<string>> {
  const hit = cache.get(adminId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.perms

  const { rows } = await pool.query<{ role_key: string; perms: string[] }>(
    `SELECT r.key AS role_key,
            COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS perms
     FROM admin_users au
     JOIN roles r ON r.id = au.role_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     WHERE au.id = $1
     GROUP BY r.key`,
    [adminId],
  )

  let perms: Set<string>
  if (rows.length === 0) {
    perms = new Set()
  } else if (rows[0].role_key === SUPER_ADMIN_ROLE_KEY) {
    perms = new Set(ALL_PERMISSION_KEYS)
  } else {
    perms = new Set(rows[0].perms)
  }

  cache.set(adminId, { perms, at: Date.now() })
  return perms
}

export function invalidatePermissionsCache(): void {
  cache.clear()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/services/permissions.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/permissions.service.ts apps/api/src/services/permissions.service.test.ts
git commit -m "feat(api): cached per-admin permission resolution

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: requirePermission middleware

**Files:**
- Create: `apps/api/src/middleware/requirePermission.ts`
- Test: `apps/api/src/middleware/requirePermission.test.ts`

**Interfaces:**
- Consumes: `getPermissionsForAdmin` from `../services/permissions.service.js`; `req.adminId` (set by `authenticateAdmin`).
- Produces: `function requirePermission(key: string): (req, reply) => Promise<void>` — sends 403 `{ error: { code:'FORBIDDEN', message } }` when missing.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/middleware/requirePermission.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/permissions.service.js', () => ({
  getPermissionsForAdmin: vi.fn(),
}))

import { getPermissionsForAdmin } from '../services/permissions.service.js'
import { requirePermission } from './requirePermission.js'

const mockGet = vi.mocked(getPermissionsForAdmin)

function fakeReply() {
  const r: any = { statusCode: 0, body: null }
  r.status = (c: number) => { r.statusCode = c; return r }
  r.send = (b: unknown) => { r.body = b; return r }
  return r
}

describe('requirePermission', () => {
  beforeEach(() => mockGet.mockReset())

  it('passes when the admin has the key', async () => {
    mockGet.mockResolvedValueOnce(new Set(['staff.view']))
    const reply = fakeReply()
    await requirePermission('staff.view')({ adminId: 'a1' } as any, reply)
    expect(reply.statusCode).toBe(0)
  })

  it('403s when the admin lacks the key', async () => {
    mockGet.mockResolvedValueOnce(new Set(['stats.view']))
    const reply = fakeReply()
    await requirePermission('staff.view')({ adminId: 'a1' } as any, reply)
    expect(reply.statusCode).toBe(403)
    expect(reply.body.error.code).toBe('FORBIDDEN')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/middleware/requirePermission.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the middleware**

Create `apps/api/src/middleware/requirePermission.ts`:

```ts
import type { FastifyRequest, FastifyReply } from 'fastify'
import { getPermissionsForAdmin } from '../services/permissions.service.js'

// Use AFTER authenticateAdmin, which sets req.adminId:
//   { preHandler: [authenticateAdmin, requirePermission('staff.view')] }
export function requirePermission(key: string) {
  return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const perms = await getPermissionsForAdmin(req.adminId)
    if (!perms.has(key)) {
      reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' },
      })
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/middleware/requirePermission.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/middleware/requirePermission.ts apps/api/src/middleware/requirePermission.test.ts
git commit -m "feat(api): requirePermission preHandler

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: LDAP bind module (real, dormant) + dependency

**Files:**
- Modify: `apps/api/package.json` (add `ldapts`)
- Create: `apps/api/src/lib/ldap-auth.ts`
- Test: `apps/api/src/lib/ldap-auth.test.ts`

**Interfaces:**
- Produces:
  - `interface LdapConfig { enabled: boolean; host: string; port: number; useTls: boolean; baseDN: string; bindDN: string; bindPassword: string; userFilter: string; groupAttribute: string; groupRoleMap: Record<string,string> }`
  - `interface LdapProfile { dn: string; email: string; name: string; groups: string[] }`
  - `async function ldapAuthenticate(cfg: LdapConfig, loginId: string, password: string): Promise<LdapProfile>`
  - `const DEFAULT_LDAP_CONFIG: LdapConfig`

- [ ] **Step 1: Add the dependency**

Run: `cd apps/api && pnpm add ldapts`
Expected: `ldapts` appears under `dependencies` in `apps/api/package.json`.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/lib/ldap-auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const bind = vi.fn()
const search = vi.fn()
const unbind = vi.fn()

vi.mock('ldapts', () => ({
  Client: vi.fn().mockImplementation(() => ({ bind, search, unbind })),
}))

import { ldapAuthenticate, DEFAULT_LDAP_CONFIG, type LdapConfig } from './ldap-auth.js'

const cfg: LdapConfig = {
  ...DEFAULT_LDAP_CONFIG,
  enabled: true,
  host: 'ldap.example.com',
  baseDN: 'dc=example,dc=com',
  bindDN: 'cn=svc,dc=example,dc=com',
  bindPassword: 'svcpw',
  userFilter: '(mail={{login}})',
}

beforeEach(() => { bind.mockReset(); search.mockReset(); unbind.mockReset() })

describe('ldapAuthenticate', () => {
  it('returns profile + groups on success', async () => {
    bind.mockResolvedValue(undefined) // service bind + user bind both succeed
    search.mockResolvedValue({ searchEntries: [{
      dn: 'cn=jane,dc=example,dc=com', mail: 'jane@example.com', cn: 'Jane',
      memberOf: ['cn=Finance,dc=example,dc=com'],
    }] })
    const p = await ldapAuthenticate(cfg, 'jane@example.com', 'userpw')
    expect(p.email).toBe('jane@example.com')
    expect(p.groups).toContain('cn=Finance,dc=example,dc=com')
    expect(unbind).toHaveBeenCalled()
  })

  it('throws LDAP_USER_NOT_FOUND when the search is empty', async () => {
    bind.mockResolvedValue(undefined)
    search.mockResolvedValue({ searchEntries: [] })
    await expect(ldapAuthenticate(cfg, 'ghost@example.com', 'x'))
      .rejects.toMatchObject({ code: 'LDAP_USER_NOT_FOUND' })
    expect(unbind).toHaveBeenCalled()
  })

  it('throws LDAP_AUTH_FAILED when the user bind rejects', async () => {
    bind.mockResolvedValueOnce(undefined) // service bind ok
    search.mockResolvedValue({ searchEntries: [{ dn: 'cn=jane,dc=example,dc=com', mail: 'jane@example.com', cn: 'Jane', memberOf: [] }] })
    bind.mockRejectedValueOnce(new Error('invalid credentials')) // user bind fails
    await expect(ldapAuthenticate(cfg, 'jane@example.com', 'wrong'))
      .rejects.toMatchObject({ code: 'LDAP_AUTH_FAILED' })
    expect(unbind).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/lib/ldap-auth.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Write the module**

Create `apps/api/src/lib/ldap-auth.ts`:

```ts
import { Client } from 'ldapts'
import { AppError } from './errors.js'

export interface LdapConfig {
  enabled: boolean
  host: string
  port: number
  useTls: boolean
  baseDN: string
  bindDN: string
  bindPassword: string
  userFilter: string       // template with {{login}}, e.g. '(mail={{login}})'
  groupAttribute: string   // e.g. 'memberOf'
  groupRoleMap: Record<string, string> // ldap group value -> role key
}

export interface LdapProfile {
  dn: string
  email: string
  name: string
  groups: string[]
}

export const DEFAULT_LDAP_CONFIG: LdapConfig = {
  enabled: false,
  host: '',
  port: 636,
  useTls: true,
  baseDN: '',
  bindDN: '',
  bindPassword: '',
  userFilter: '(mail={{login}})',
  groupAttribute: 'memberOf',
  groupRoleMap: {},
}

function url(cfg: LdapConfig): string {
  const scheme = cfg.useTls ? 'ldaps' : 'ldap'
  return `${scheme}://${cfg.host}:${cfg.port}`
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (v == null) return []
  return [String(v)]
}

// Real LDAP authentication: service-bind, find the user, rebind AS the user to
// verify the password, then read group membership. Directory-only; the caller
// maps groups to a role. Dormant in production until ldap_config.enabled is true.
export async function ldapAuthenticate(
  cfg: LdapConfig,
  loginId: string,
  password: string,
): Promise<LdapProfile> {
  const client = new Client({ url: url(cfg) })
  try {
    // 1. Service bind (skip if no service account configured).
    if (cfg.bindDN) {
      try {
        await client.bind(cfg.bindDN, cfg.bindPassword)
      } catch {
        throw new AppError('LDAP_SERVICE_BIND_FAILED', 'Directory service bind failed.', 502)
      }
    }

    // 2. Find the user under baseDN.
    const filter = cfg.userFilter.replace('{{login}}', loginId)
    const { searchEntries } = await client.search(cfg.baseDN, {
      scope: 'sub',
      filter,
      attributes: ['dn', 'mail', 'cn', cfg.groupAttribute],
    })
    if (searchEntries.length === 0) {
      throw new AppError('LDAP_USER_NOT_FOUND', 'No matching directory user.', 401)
    }
    const entry = searchEntries[0] as Record<string, unknown>
    const dn = String(entry.dn)

    // 3. Verify the password by binding AS the user.
    try {
      await client.bind(dn, password)
    } catch {
      throw new AppError('LDAP_AUTH_FAILED', 'Invalid directory credentials.', 401)
    }

    return {
      dn,
      email: entry.mail ? String(entry.mail) : loginId,
      name: entry.cn ? String(entry.cn) : loginId,
      groups: asArray(entry[cfg.groupAttribute]),
    }
  } finally {
    await client.unbind().catch(() => {})
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/lib/ldap-auth.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/lib/ldap-auth.ts apps/api/src/lib/ldap-auth.test.ts ../../pnpm-lock.yaml
git commit -m "feat(api): real LDAP bind module (dormant until enabled)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: LDAP config service (game_settings store)

**Files:**
- Create: `apps/api/src/services/ldap-config.service.ts`

**Interfaces:**
- Consumes: `pool` from `@betting/db`; `LdapConfig`, `DEFAULT_LDAP_CONFIG` from `../lib/ldap-auth.js`.
- Produces:
  - `async function getLdapConfig(): Promise<LdapConfig>`
  - `async function setLdapConfig(cfg: LdapConfig): Promise<void>`

- [ ] **Step 1: Write the service**

Create `apps/api/src/services/ldap-config.service.ts`:

```ts
import { pool } from '@betting/db'
import { DEFAULT_LDAP_CONFIG, type LdapConfig } from '../lib/ldap-auth.js'

const KEY = 'ldap_config'

export async function getLdapConfig(): Promise<LdapConfig> {
  const { rows } = await pool.query<{ value: unknown }>(
    `SELECT value FROM game_settings WHERE key = $1`, [KEY],
  )
  if (rows.length === 0) return { ...DEFAULT_LDAP_CONFIG }
  return { ...DEFAULT_LDAP_CONFIG, ...(rows[0].value as Partial<LdapConfig>) }
}

export async function setLdapConfig(cfg: LdapConfig): Promise<void> {
  await pool.query(
    `INSERT INTO game_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [KEY, JSON.stringify(cfg)],
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/ldap-config.service.ts
git commit -m "feat(api): ldap_config store in game_settings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: staff-auth service + login refactor

**Files:**
- Create: `apps/api/src/services/staff-auth.service.ts`
- Test: `apps/api/src/services/staff-auth.service.test.ts`
- Modify: `apps/api/src/services/admin-auth.service.ts`
- Modify: `apps/api/src/routes/admin/auth.ts`

**Interfaces:**
- Consumes: `pool`, `verifyPassword`, `AppError`, `getLdapConfig`, `ldapAuthenticate`.
- Produces:
  - `interface StaffAuthResult { id: string; name: string; email: string; role: string; mustChangePassword: boolean }`
  - `async function authenticateStaff(email: string, password: string): Promise<StaffAuthResult>`
  - `loginAdmin` now returns `{ accessToken, refreshToken, admin, mustChangePassword }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/staff-auth.service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))
vi.mock('../lib/hash.js', () => ({ verifyPassword: vi.fn() }))
vi.mock('./ldap-config.service.js', () => ({ getLdapConfig: vi.fn() }))
vi.mock('../lib/ldap-auth.js', () => ({ ldapAuthenticate: vi.fn() }))

import { pool } from '@betting/db'
import { verifyPassword } from '../lib/hash.js'
import { getLdapConfig } from './ldap-config.service.js'
import { ldapAuthenticate } from '../lib/ldap-auth.js'
import { authenticateStaff } from './staff-auth.service.js'

const mockQuery = vi.mocked(pool.query)
const mockVerify = vi.mocked(verifyPassword)
const mockLdapCfg = vi.mocked(getLdapConfig)
const mockLdapAuth = vi.mocked(ldapAuthenticate)

const localRow = {
  id: 'u1', name: 'Jane', email: 'jane@x.com', role: 'finance',
  status: 'active', password_hash: 'h', auth_provider: 'local', must_change_password: false,
}

beforeEach(() => { mockQuery.mockReset(); mockVerify.mockReset(); mockLdapCfg.mockReset(); mockLdapAuth.mockReset() })

describe('authenticateStaff (local)', () => {
  it('succeeds with a valid password', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [localRow] } as never)
    mockVerify.mockResolvedValueOnce(true)
    const r = await authenticateStaff('jane@x.com', 'pw')
    expect(r.id).toBe('u1')
    expect(r.role).toBe('finance')
    expect(mockLdapAuth).not.toHaveBeenCalled()
  })

  it('rejects a bad password', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [localRow] } as never)
    mockVerify.mockResolvedValueOnce(false)
    await expect(authenticateStaff('jane@x.com', 'bad')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('rejects a suspended account', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...localRow, status: 'suspended' }] } as never)
    mockVerify.mockResolvedValueOnce(true)
    await expect(authenticateStaff('jane@x.com', 'pw')).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' })
  })
})

describe('authenticateStaff (ldap seam)', () => {
  it('uses the ldap module when provider=ldap and enabled, mapping group->role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...localRow, auth_provider: 'ldap' }] } as never)
    mockLdapCfg.mockResolvedValueOnce({ enabled: true, groupRoleMap: { 'cn=Finance': 'finance' } } as never)
    mockLdapAuth.mockResolvedValueOnce({ dn: 'd', email: 'jane@x.com', name: 'Jane', groups: ['cn=Finance'] } as never)
    const r = await authenticateStaff('jane@x.com', 'pw')
    expect(mockLdapAuth).toHaveBeenCalled()
    expect(r.role).toBe('finance')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/services/staff-auth.service.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the staff-auth service**

Create `apps/api/src/services/staff-auth.service.ts`:

```ts
import { pool } from '@betting/db'
import { verifyPassword } from '../lib/hash.js'
import { AppError } from '../lib/errors.js'
import { getLdapConfig } from './ldap-config.service.js'
import { ldapAuthenticate } from '../lib/ldap-auth.js'

export interface StaffAuthResult {
  id: string
  name: string
  email: string
  role: string
  mustChangePassword: boolean
}

interface StaffRow {
  id: string
  name: string
  email: string
  role: string
  status: string
  password_hash: string
  auth_provider: string
  must_change_password: boolean
}

export async function authenticateStaff(email: string, password: string): Promise<StaffAuthResult> {
  const { rows } = await pool.query<StaffRow>(
    `SELECT id, name, email, role, status, password_hash, auth_provider, must_change_password
     FROM admin_users WHERE email = $1`,
    [email],
  )
  if (rows.length === 0) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
  const u = rows[0]

  // LDAP branch: dormant by default (provider defaults 'local', config disabled).
  if (u.auth_provider === 'ldap') {
    const cfg = await getLdapConfig()
    if (cfg.enabled) {
      const profile = await ldapAuthenticate(cfg, email, password)
      const mapped = Object.entries(cfg.groupRoleMap).find(([g]) => profile.groups.includes(g))
      if (!mapped) throw new AppError('LDAP_NO_ROLE', 'Your directory groups do not map to a role.', 403)
      if (u.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED', 'This account has been suspended.', 403)
      return { id: u.id, name: u.name, email: u.email, role: mapped[1], mustChangePassword: false }
    }
    // enabled=false: fall through to local (no valid local hash => rejected).
  }

  const ok = await verifyPassword(password, u.password_hash)
  if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
  if (u.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED', 'This account has been suspended.', 403)

  return { id: u.id, name: u.name, email: u.email, role: u.role, mustChangePassword: u.must_change_password }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/services/staff-auth.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `loginAdmin` to use `authenticateStaff`**

Replace the body of `apps/api/src/services/admin-auth.service.ts` with:

```ts
import crypto from 'crypto'
import { pool } from '@betting/db'
import { signAdminAccessToken } from '../lib/jwt.js'
import { AppError } from './auth.service.js'
import { authenticateStaff } from './staff-auth.service.js'

export async function loginAdmin(
  email: string,
  password: string,
): Promise<{
  accessToken: string
  refreshToken: string
  admin: { id: string; name: string; email: string; role: string }
  mustChangePassword: boolean
}> {
  const staff = await authenticateStaff(email, password)

  const accessToken = signAdminAccessToken(staff.id, staff.role)

  const refreshToken = crypto.randomUUID()
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await pool.query(
    `INSERT INTO admin_refresh_tokens (admin_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [staff.id, tokenHash, expiresAt],
  )
  await pool.query(`UPDATE admin_users SET last_login_at = NOW() WHERE id = $1`, [staff.id])

  return {
    accessToken,
    refreshToken,
    admin: { id: staff.id, name: staff.name, email: staff.email, role: staff.role },
    mustChangePassword: staff.mustChangePassword,
  }
}

export async function logoutAdmin(refreshToken: string): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
  await pool.query('DELETE FROM admin_refresh_tokens WHERE token_hash = $1', [tokenHash])
}
```

> Note: `AppError` here is imported from `./auth.service.js` (existing pattern). `authenticateStaff` throws the `../lib/errors.js` `AppError`; both are caught by `routes/admin/auth.ts` via `instanceof` against the `auth.service` re-export. If the two `AppError` classes differ, the route already handles the `lib/errors` one through the global error handler in `server.ts`. Verify the login route still returns the friendly 401 in Step 7.

- [ ] **Step 6: Include `mustChangePassword` in the login response**

In `apps/api/src/routes/admin/auth.ts`, change the destructuring and response:

```ts
      const { accessToken, refreshToken, admin, mustChangePassword } = await loginAdmin(
        parsed.data.email,
        parsed.data.password,
      )
```

and

```ts
      return reply.send({ access_token: accessToken, admin, mustChangePassword })
```

- [ ] **Step 7: Run the full API suite + typecheck**

Run: `cd apps/api && npx vitest run && npx tsc --noEmit`
Expected: all pass (existing `admin-auth.service.test.ts` still green; if it asserted old behavior, update its mocks to expect `authenticateStaff`'s query first — see that file and adjust the mocked query sequence to return a staff row, then `verifyPassword=true`).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/staff-auth.service.ts apps/api/src/services/staff-auth.service.test.ts apps/api/src/services/admin-auth.service.ts apps/api/src/routes/admin/auth.ts
git commit -m "feat(api): authenticateStaff seam + login returns mustChangePassword

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Staff CRUD routes

**Files:**
- Create: `apps/api/src/routes/admin/staff.ts`
- Test: `apps/api/src/routes/admin/staff.test.ts`

**Interfaces:**
- Consumes: `authenticateAdmin`, `requirePermission`, `pool`, `hashPassword`, `AppError`, `invalidatePermissionsCache`, `getLdapConfig`/`setLdapConfig`, `SUPER_ADMIN_ROLE_KEY`.
- Produces routes: `GET/POST /admin/staff`, `PUT /admin/staff/:id`, `PUT /admin/staff/:id/status`, `POST /admin/staff/:id/reset-password`, `GET/PUT /admin/ldap-config`. Registered as `adminStaffRoutes`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/admin/staff.test.ts`:

```ts
import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: vi.fn(async (req: { adminId: string }) => { req.adminId = 'admin-1' }),
}))
vi.mock('../../services/permissions.service.js', () => ({
  getPermissionsForAdmin: vi.fn(async () => ({ has: () => true })),
  invalidatePermissionsCache: vi.fn(),
}))
vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))
vi.mock('../../lib/hash.js', () => ({ hashPassword: vi.fn(async (p: string) => `hashed_${p}`) }))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)

describe('GET /admin/staff', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('lists staff', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 'u1', name: 'Jane', email: 'jane@x.com', role_name: 'Finance', role_id: 'r1', status: 'active', auth_provider: 'local', last_login_at: null },
    ] } as never)
    const res = await app.inject({ method: 'GET', url: '/admin/staff', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().staff).toHaveLength(1)
  })
})

describe('POST /admin/staff', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('creates a staff member', async () => {
    // role lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', key: 'finance' }] } as never)
    // insert
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'new-1' }] } as never)
    // audit
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = await app.inject({
      method: 'POST', url: '/admin/staff', headers: { Authorization: 'Bearer t' },
      payload: { name: 'Otis', email: 'otis@x.com', roleId: 'r1', password: 'temp1234' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe('new-1')
  })

  it('rejects a short password', async () => {
    const res = await app.inject({
      method: 'POST', url: '/admin/staff', headers: { Authorization: 'Bearer t' },
      payload: { name: 'Otis', email: 'otis@x.com', roleId: 'r1', password: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PUT /admin/staff/:id/status guardrail', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('blocks suspending the last active super admin', async () => {
    // target row: super_admin + active
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', role_key: 'super_admin', status: 'active' }] } as never)
    // count of OTHER active super admins = 0
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '0' }] } as never)
    const res = await app.inject({
      method: 'PUT', url: '/admin/staff/u1/status', headers: { Authorization: 'Bearer t' },
      payload: { status: 'suspended' },
    })
    expect(res.statusCode).toBe(409)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/admin/staff.test.ts`
Expected: FAIL (module not found / route 404).

- [ ] **Step 3: Write the routes**

Create `apps/api/src/routes/admin/staff.ts`:

```ts
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { hashPassword } from '../../lib/hash.js'
import { AppError } from '../../lib/errors.js'
import { invalidatePermissionsCache } from '../../services/permissions.service.js'
import { getLdapConfig, setLdapConfig } from '../../services/ldap-config.service.js'
import { DEFAULT_LDAP_CONFIG } from '../../lib/ldap-auth.js'
import { SUPER_ADMIN_ROLE_KEY } from '../../lib/permissions.js'

async function audit(adminId: string, action: string, entityId: string | null, after: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO admin_audit_log (admin_id, action, entity, entity_id, after) VALUES ($1, $2, 'staff', $3, $4::jsonb)`,
    [adminId, action, entityId, JSON.stringify(after ?? {})],
  )
}

// Number of OTHER active super admins (excluding a given id).
async function otherActiveSuperAdmins(excludeId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM admin_users au
     JOIN roles r ON r.id = au.role_id
     WHERE r.key = $1 AND au.status = 'active' AND au.id <> $2`,
    [SUPER_ADMIN_ROLE_KEY, excludeId],
  )
  return Number(rows[0].n)
}

export async function adminStaffRoutes(app: FastifyInstance) {
  app.get('/admin/staff', { preHandler: [authenticateAdmin, requirePermission('staff.view')] }, async (_req, reply) => {
    const { rows } = await pool.query(
      `SELECT au.id, au.name, au.email, au.status, au.auth_provider, au.last_login_at,
              au.role_id, r.name AS role_name, r.key AS role_key
       FROM admin_users au
       LEFT JOIN roles r ON r.id = au.role_id
       ORDER BY au.name ASC`,
    )
    return reply.send({ staff: rows })
  })

  app.post('/admin/staff', { preHandler: [authenticateAdmin, requirePermission('staff.create')] }, async (req, reply) => {
    const parsed = z.object({
      name: z.string().min(1).max(255),
      email: z.string().email(),
      roleId: z.string().uuid(),
      password: z.string().min(8, 'Password must be at least 8 characters.'),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    const { rows: roleRows } = await pool.query<{ id: string; key: string }>(`SELECT id, key FROM roles WHERE id = $1`, [parsed.data.roleId])
    if (roleRows.length === 0) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Unknown role.' } })

    const hash = await hashPassword(parsed.data.password)
    try {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO admin_users (name, email, password_hash, role, role_id, status, must_change_password, created_by)
         VALUES ($1, $2, $3, $4, $5, 'active', true, $6) RETURNING id`,
        [parsed.data.name, parsed.data.email, hash, roleRows[0].key, roleRows[0].id, req.adminId],
      )
      await audit(req.adminId, 'staff_create', rows[0].id, { email: parsed.data.email, roleId: parsed.data.roleId })
      return reply.send({ id: rows[0].id })
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.status(409).send({ error: { code: 'EMAIL_TAKEN', message: 'That email is already in use.' } })
      }
      throw err
    }
  })

  app.put('/admin/staff/:id', { preHandler: [authenticateAdmin, requirePermission('staff.edit')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({
      name: z.string().min(1).max(255).optional(),
      roleId: z.string().uuid().optional(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    // Guardrail: moving the last active super admin off super_admin is blocked.
    if (parsed.data.roleId) {
      const { rows: cur } = await pool.query<{ role_key: string; status: string }>(
        `SELECT r.key AS role_key, au.status FROM admin_users au JOIN roles r ON r.id = au.role_id WHERE au.id = $1`, [id],
      )
      if (cur.length && cur[0].role_key === SUPER_ADMIN_ROLE_KEY && cur[0].status === 'active') {
        const { rows: newRole } = await pool.query<{ key: string }>(`SELECT key FROM roles WHERE id = $1`, [parsed.data.roleId])
        if (newRole.length && newRole[0].key !== SUPER_ADMIN_ROLE_KEY && (await otherActiveSuperAdmins(id)) === 0) {
          return reply.status(409).send({ error: { code: 'LAST_SUPER_ADMIN', message: 'You cannot remove the last active Super Admin.' } })
        }
      }
    }

    let roleKey: string | null = null
    if (parsed.data.roleId) {
      const { rows } = await pool.query<{ key: string }>(`SELECT key FROM roles WHERE id = $1`, [parsed.data.roleId])
      if (rows.length === 0) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Unknown role.' } })
      roleKey = rows[0].key
    }

    const { rowCount } = await pool.query(
      `UPDATE admin_users SET
         name = COALESCE($2, name),
         role_id = COALESCE($3, role_id),
         role = COALESCE($4, role)
       WHERE id = $1`,
      [id, parsed.data.name ?? null, parsed.data.roleId ?? null, roleKey],
    )
    if (!rowCount) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Staff not found.' } })
    invalidatePermissionsCache()
    await audit(req.adminId, 'staff_update', id, parsed.data)
    return reply.send({ ok: true })
  })

  app.put('/admin/staff/:id/status', { preHandler: [authenticateAdmin, requirePermission('staff.suspend')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({ status: z.enum(['active', 'suspended']) }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid status.' } })

    if (id === req.adminId && parsed.data.status === 'suspended') {
      return reply.status(409).send({ error: { code: 'CANNOT_SUSPEND_SELF', message: 'You cannot suspend your own account.' } })
    }

    const { rows } = await pool.query<{ id: string; role_key: string; status: string }>(
      `SELECT au.id, r.key AS role_key, au.status FROM admin_users au JOIN roles r ON r.id = au.role_id WHERE au.id = $1`, [id],
    )
    if (rows.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Staff not found.' } })

    if (parsed.data.status === 'suspended' && rows[0].role_key === SUPER_ADMIN_ROLE_KEY) {
      if ((await otherActiveSuperAdmins(id)) === 0) {
        return reply.status(409).send({ error: { code: 'LAST_SUPER_ADMIN', message: 'You cannot suspend the last active Super Admin.' } })
      }
    }

    await pool.query(`UPDATE admin_users SET status = $2 WHERE id = $1`, [id, parsed.data.status])
    invalidatePermissionsCache()
    await audit(req.adminId, 'staff_status', id, { status: parsed.data.status })
    return reply.send({ ok: true })
  })

  app.post('/admin/staff/:id/reset-password', { preHandler: [authenticateAdmin, requirePermission('staff.reset_password')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({ password: z.string().min(8, 'Password must be at least 8 characters.') }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    const hash = await hashPassword(parsed.data.password)
    const { rowCount } = await pool.query(
      `UPDATE admin_users SET password_hash = $2, must_change_password = true WHERE id = $1`, [id, hash],
    )
    if (!rowCount) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Staff not found.' } })
    await audit(req.adminId, 'staff_reset_password', id, {})
    return reply.send({ ok: true })
  })

  // LDAP config (directory / SSO): gated with the staff permissions since it is
  // an access-administration concern. bindPassword is never returned.
  app.get('/admin/ldap-config', { preHandler: [authenticateAdmin, requirePermission('staff.view')] }, async (_req, reply) => {
    const cfg = await getLdapConfig()
    const { bindPassword, ...safe } = cfg
    return reply.send({ config: { ...safe, hasBindPassword: Boolean(bindPassword) } })
  })

  app.put('/admin/ldap-config', { preHandler: [authenticateAdmin, requirePermission('staff.edit')] }, async (req, reply) => {
    const parsed = z.object({
      enabled: z.boolean(),
      host: z.string(),
      port: z.number().int().min(1).max(65535),
      useTls: z.boolean(),
      baseDN: z.string(),
      bindDN: z.string(),
      bindPassword: z.string().optional(), // omit/empty keeps the stored one
      userFilter: z.string(),
      groupAttribute: z.string(),
      groupRoleMap: z.record(z.string()),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    const current = await getLdapConfig()
    const next = {
      ...DEFAULT_LDAP_CONFIG,
      ...parsed.data,
      bindPassword: parsed.data.bindPassword && parsed.data.bindPassword.length > 0
        ? parsed.data.bindPassword
        : current.bindPassword,
    }
    await setLdapConfig(next)
    await audit(req.adminId, 'ldap_config_update', null, { enabled: next.enabled, host: next.host })
    return reply.send({ ok: true })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/routes/admin/staff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/staff.ts apps/api/src/routes/admin/staff.test.ts
git commit -m "feat(api): staff CRUD + ldap-config routes with guardrails

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Roles routes + permissions catalog endpoint

**Files:**
- Create: `apps/api/src/routes/admin/roles.ts`
- Test: `apps/api/src/routes/admin/roles.test.ts`

**Interfaces:**
- Consumes: `authenticateAdmin`, `requirePermission`, `pool`, `AppError`, `invalidatePermissionsCache`, `PERMISSION_CATALOG`, `ALL_PERMISSION_KEYS`, `isValidPermission`, `SUPER_ADMIN_ROLE_KEY`.
- Produces routes: `GET /admin/roles`, `GET /admin/permissions-catalog`, `POST /admin/roles`, `PUT /admin/roles/:id`, `DELETE /admin/roles/:id`. Registered as `adminRolesRoutes`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/admin/roles.test.ts`:

```ts
import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: vi.fn(async (req: { adminId: string }) => { req.adminId = 'admin-1' }),
}))
vi.mock('../../services/permissions.service.js', () => ({
  getPermissionsForAdmin: vi.fn(async () => ({ has: () => true })),
  invalidatePermissionsCache: vi.fn(),
}))
vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)

describe('GET /admin/permissions-catalog', () => {
  const app = buildServer()
  afterAll(() => app.close())
  it('returns the catalog', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/permissions-catalog', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().catalog.some((g: { area: string }) => g.area === 'staff')).toBe(true)
  })
})

describe('POST /admin/roles', () => {
  const app = buildServer()
  afterAll(() => app.close())
  it('rejects an unknown permission key', async () => {
    const res = await app.inject({
      method: 'POST', url: '/admin/roles', headers: { Authorization: 'Bearer t' },
      payload: { key: 'ops', name: 'Ops', description: '', permissions: ['not.a.key'] },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /admin/roles/:id', () => {
  const app = buildServer()
  afterAll(() => app.close())
  it('blocks deleting a role in use', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', key: 'ops', is_system: false }] } as never) // role
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '2' }] } as never) // assigned staff count
    const res = await app.inject({ method: 'DELETE', url: '/admin/roles/r1', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(409)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/admin/roles.test.ts`
Expected: FAIL (route 404 / module not found).

- [ ] **Step 3: Write the routes**

Create `apps/api/src/routes/admin/roles.ts`:

```ts
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { invalidatePermissionsCache } from '../../services/permissions.service.js'
import { PERMISSION_CATALOG, ALL_PERMISSION_KEYS, isValidPermission, SUPER_ADMIN_ROLE_KEY } from '../../lib/permissions.js'

async function audit(adminId: string, action: string, entityId: string | null, after: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO admin_audit_log (admin_id, action, entity, entity_id, after) VALUES ($1, $2, 'role', $3, $4::jsonb)`,
    [adminId, action, entityId, JSON.stringify(after ?? {})],
  )
}

export async function adminRolesRoutes(app: FastifyInstance) {
  app.get('/admin/permissions-catalog', { preHandler: [authenticateAdmin, requirePermission('roles.view')] }, async (_req, reply) => {
    return reply.send({ catalog: PERMISSION_CATALOG })
  })

  app.get('/admin/roles', { preHandler: [authenticateAdmin, requirePermission('roles.view')] }, async (_req, reply) => {
    const { rows } = await pool.query<{ id: string; key: string; name: string; description: string | null; is_system: boolean; perms: string[] }>(
      `SELECT r.id, r.key, r.name, r.description, r.is_system,
              COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS perms
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
       GROUP BY r.id ORDER BY r.is_system DESC, r.name ASC`,
    )
    const roles = rows.map(r => ({
      id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.is_system,
      locked: r.key === SUPER_ADMIN_ROLE_KEY,
      permissions: r.key === SUPER_ADMIN_ROLE_KEY ? ALL_PERMISSION_KEYS : r.perms,
    }))
    return reply.send({ roles })
  })

  app.post('/admin/roles', { preHandler: [authenticateAdmin, requirePermission('roles.create')] }, async (req, reply) => {
    const parsed = z.object({
      key: z.string().min(2).max(40).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers, underscores.'),
      name: z.string().min(1).max(80),
      description: z.string().max(255).optional(),
      permissions: z.array(z.string()).default([]),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    const bad = parsed.data.permissions.filter(k => !isValidPermission(k))
    if (bad.length) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: `Unknown permission: ${bad[0]}` } })
    if (parsed.data.key === SUPER_ADMIN_ROLE_KEY) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Reserved role key.' } })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO roles (key, name, description, is_system) VALUES ($1, $2, $3, false) RETURNING id`,
        [parsed.data.key, parsed.data.name, parsed.data.description ?? null],
      )
      const roleId = rows[0].id
      for (const key of parsed.data.permissions) {
        await client.query(`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)`, [roleId, key])
      }
      await client.query('COMMIT')
      invalidatePermissionsCache()
      await audit(req.adminId, 'role_create', roleId, { key: parsed.data.key, permissions: parsed.data.permissions })
      return reply.send({ id: roleId })
    } catch (err) {
      await client.query('ROLLBACK')
      if ((err as { code?: string }).code === '23505') {
        return reply.status(409).send({ error: { code: 'ROLE_KEY_TAKEN', message: 'That role key already exists.' } })
      }
      throw err
    } finally {
      client.release()
    }
  })

  app.put('/admin/roles/:id', { preHandler: [authenticateAdmin, requirePermission('roles.edit')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({
      name: z.string().min(1).max(80).optional(),
      description: z.string().max(255).optional(),
      permissions: z.array(z.string()).optional(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    const { rows: roleRows } = await pool.query<{ key: string }>(`SELECT key FROM roles WHERE id = $1`, [id])
    if (roleRows.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Role not found.' } })
    if (roleRows[0].key === SUPER_ADMIN_ROLE_KEY) {
      return reply.status(403).send({ error: { code: 'ROLE_LOCKED', message: 'The Super Admin role cannot be edited.' } })
    }
    if (parsed.data.permissions) {
      const bad = parsed.data.permissions.filter(k => !isValidPermission(k))
      if (bad.length) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: `Unknown permission: ${bad[0]}` } })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      if (parsed.data.name !== undefined || parsed.data.description !== undefined) {
        await client.query(
          `UPDATE roles SET name = COALESCE($2, name), description = COALESCE($3, description) WHERE id = $1`,
          [id, parsed.data.name ?? null, parsed.data.description ?? null],
        )
      }
      if (parsed.data.permissions) {
        await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [id])
        for (const key of parsed.data.permissions) {
          await client.query(`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)`, [id, key])
        }
      }
      await client.query('COMMIT')
      invalidatePermissionsCache()
      await audit(req.adminId, 'role_update', id, parsed.data)
      return reply.send({ ok: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  app.delete('/admin/roles/:id', { preHandler: [authenticateAdmin, requirePermission('roles.delete')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await pool.query<{ id: string; key: string; is_system: boolean }>(`SELECT id, key, is_system FROM roles WHERE id = $1`, [id])
    if (rows.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Role not found.' } })
    if (rows[0].is_system) return reply.status(403).send({ error: { code: 'ROLE_LOCKED', message: 'System roles cannot be deleted.' } })

    const { rows: usage } = await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM admin_users WHERE role_id = $1`, [id])
    if (Number(usage[0].n) > 0) {
      return reply.status(409).send({ error: { code: 'ROLE_IN_USE', message: 'Reassign staff off this role before deleting it.' } })
    }

    await pool.query(`DELETE FROM roles WHERE id = $1`, [id])
    invalidatePermissionsCache()
    await audit(req.adminId, 'role_delete', id, { key: rows[0].key })
    return reply.send({ ok: true })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/routes/admin/roles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/roles.ts apps/api/src/routes/admin/roles.test.ts
git commit -m "feat(api): roles CRUD + permissions catalog endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: /admin/me + change-password routes + server registration

**Files:**
- Create: `apps/api/src/routes/admin/me.ts`
- Test: `apps/api/src/routes/admin/me.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `authenticateAdmin`, `getPermissionsForAdmin`, `pool`, `verifyPassword`, `hashPassword`, `AppError`.
- Produces routes: `GET /admin/me`, `POST /admin/change-password`. Registered as `adminMeRoutes`. Also registers `adminStaffRoutes`, `adminRolesRoutes`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/admin/me.test.ts`:

```ts
import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: vi.fn(async (req: { adminId: string; adminRole: string }) => { req.adminId = 'admin-1'; req.adminRole = 'super_admin' }),
}))
vi.mock('../../services/permissions.service.js', () => ({
  getPermissionsForAdmin: vi.fn(async () => new Set(['stats.view', 'staff.view'])),
  invalidatePermissionsCache: vi.fn(),
}))
vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))
vi.mock('../../lib/hash.js', () => ({ hashPassword: vi.fn(async (p: string) => `hashed_${p}`), verifyPassword: vi.fn(async () => true) }))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)

describe('GET /admin/me', () => {
  const app = buildServer()
  afterAll(() => app.close())
  it('returns profile + permissions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'admin-1', name: 'Boss', email: 'boss@x.com', role_name: 'Super Admin' }] } as never)
    const res = await app.inject({ method: 'GET', url: '/admin/me', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().permissions).toContain('staff.view')
  })
})

describe('POST /admin/change-password', () => {
  const app = buildServer()
  afterAll(() => app.close())
  it('changes the password and clears must_change', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: 'h' }] } as never) // load
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // update
    const res = await app.inject({
      method: 'POST', url: '/admin/change-password', headers: { Authorization: 'Bearer t' },
      payload: { currentPassword: 'old', newPassword: 'newpass123' },
    })
    expect(res.statusCode).toBe(200)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/admin/me.test.ts`
Expected: FAIL (route 404).

- [ ] **Step 3: Write the routes**

Create `apps/api/src/routes/admin/me.ts`:

```ts
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { getPermissionsForAdmin } from '../../services/permissions.service.js'
import { hashPassword, verifyPassword } from '../../lib/hash.js'

export async function adminMeRoutes(app: FastifyInstance) {
  app.get('/admin/me', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { rows } = await pool.query<{ id: string; name: string; email: string; role_name: string | null }>(
      `SELECT au.id, au.name, au.email, r.name AS role_name
       FROM admin_users au LEFT JOIN roles r ON r.id = au.role_id WHERE au.id = $1`,
      [req.adminId],
    )
    if (rows.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Account not found.' } })
    const perms = await getPermissionsForAdmin(req.adminId)
    return reply.send({
      id: rows[0].id, name: rows[0].name, email: rows[0].email,
      role: rows[0].role_name, roleKey: req.adminRole,
      permissions: Array.from(perms),
    })
  })

  app.post('/admin/change-password', { preHandler: authenticateAdmin }, async (req, reply) => {
    const parsed = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, 'Password must be at least 8 characters.'),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    const { rows } = await pool.query<{ password_hash: string }>(`SELECT password_hash FROM admin_users WHERE id = $1`, [req.adminId])
    if (rows.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Account not found.' } })
    const ok = await verifyPassword(parsed.data.currentPassword, rows[0].password_hash)
    if (!ok) return reply.status(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Your current password is incorrect.' } })

    const hash = await hashPassword(parsed.data.newPassword)
    await pool.query(`UPDATE admin_users SET password_hash = $2, must_change_password = false WHERE id = $1`, [req.adminId, hash])
    return reply.send({ ok: true })
  })
}
```

- [ ] **Step 4: Register all new route modules in `server.ts`**

Add imports near the other admin route imports:

```ts
import { adminStaffRoutes } from './routes/admin/staff.js'
import { adminRolesRoutes } from './routes/admin/roles.js'
import { adminMeRoutes } from './routes/admin/me.js'
```

Add registrations alongside the other `app.register(admin...)` calls:

```ts
  app.register(adminStaffRoutes)
  app.register(adminRolesRoutes)
  app.register(adminMeRoutes)
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd apps/api && npx vitest run src/routes/admin/me.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/me.ts apps/api/src/routes/admin/me.test.ts apps/api/src/server.ts
git commit -m "feat(api): /admin/me + change-password; register RBAC routes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Retrofit chat + withdrawals to requirePermission

**Files:**
- Modify: `apps/api/src/routes/admin/chat.ts`
- Modify: `apps/api/src/routes/admin/withdrawals.ts`

**Interfaces:**
- Consumes: `requirePermission` from `../../middleware/requirePermission.js`.
- Produces: chat mutations gated by `chat.moderate` (delete/ban/unban), `chat.reset_username`, `chat.words`, `chat.config`; withdrawal approve/reject gated by `withdrawals.approve`/`withdrawals.reject`, threshold config by `withdrawals.config`.

- [ ] **Step 1: Retrofit chat.ts**

In `apps/api/src/routes/admin/chat.ts`:
- Add import: `import { requirePermission } from '../../middleware/requirePermission.js'`
- Delete the `MODERATOR_ROLES` const and the `requireMod` function.
- For each route, replace `{ preHandler: authenticateAdmin }` + `if (!requireMod(req, reply)) return` with a preHandler array and remove the inline guard. Exact mapping:
  - `POST /admin/chat/messages/:id/delete` -> `{ preHandler: [authenticateAdmin, requirePermission('chat.moderate')] }`
  - `POST /admin/chat/ban` -> `chat.moderate`
  - `POST /admin/chat/unban` -> `chat.moderate`
  - `POST /admin/chat/reset-username` -> `chat.reset_username`
  - `POST /admin/chat/banned-words` -> `chat.words`
  - `DELETE /admin/chat/banned-words/:word` -> `chat.words`
  - `PUT /admin/chat/settings` -> `chat.config`
  - The four `GET` routes stay `{ preHandler: authenticateAdmin }` (any admin can read) OR add `requirePermission('chat.view')` if you want read gating; keep them as `authenticateAdmin` only to preserve current behavior.

Example transform for the delete route (remove the inline guard line):

```ts
  app.post('/admin/chat/messages/:id/delete', { preHandler: [authenticateAdmin, requirePermission('chat.moderate')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const game = await deleteMessage(id, req.adminId)
    if (!game) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Message not found or already deleted.' } })
    broadcastChatDeleted(game, id)
    await audit(req.adminId, 'chat_message_delete', id, { game })
    return reply.send({ ok: true })
  })
```

Apply the same pattern (array preHandler, drop the `if (!requireMod...) return` line) to ban, unban, reset-username, banned-words add/delete, and settings, using the permission keys listed above.

- [ ] **Step 2: Retrofit withdrawals.ts**

In `apps/api/src/routes/admin/withdrawals.ts`:
- Add import: `import { requirePermission } from '../../middleware/requirePermission.js'`
- Delete the `APPROVER_ROLES` const and the `requireApprover` function.
- Replace guards:
  - `PUT /admin/withdrawal-config` -> `{ preHandler: [authenticateAdmin, requirePermission('withdrawals.config')] }`, drop `if (!requireApprover...) return`.
  - `POST /admin/withdrawals/:id/approve` -> `requirePermission('withdrawals.approve')`, drop guard.
  - `POST /admin/withdrawals/:id/reject` -> `requirePermission('withdrawals.reject')`, drop guard.
  - Leave `GET /admin/withdrawals`, `GET /admin/withdrawal-config`, and the `/retry` route as `{ preHandler: authenticateAdmin }` (unchanged).

- [ ] **Step 3: Update affected tests to mock the permissions service**

If `apps/api/src/routes/admin/chat.test.ts` or a withdrawals test exists, add this mock at the top so the permission preHandler passes:

```ts
vi.mock('../../services/permissions.service.js', () => ({
  getPermissionsForAdmin: vi.fn(async () => ({ has: () => true })),
  invalidatePermissionsCache: vi.fn(),
}))
```

(If no such test files exist, skip — the new route tests already cover the middleware.)

- [ ] **Step 4: Run the full suite + typecheck**

Run: `cd apps/api && npx vitest run && npx tsc --noEmit`
Expected: all pass. If a retrofitted route's existing test now 403s, it is missing the permissions-service mock from Step 3 — add it.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/chat.ts apps/api/src/routes/admin/withdrawals.ts apps/api/src/routes/admin/chat.test.ts
git commit -m "refactor(api): gate chat + withdrawals via requirePermission

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Admin app — Me helper + login/change-password flow

**Files:**
- Create: `apps/admin/src/lib/me.ts`
- Create: `apps/admin/src/app/change-password/page.tsx`
- Modify: `apps/admin/src/app/login/page.tsx`

**Interfaces:**
- Produces:
  - `interface Me { id: string; name: string; email: string; role: string | null; roleKey: string | null; permissions: string[] }`
  - `async function fetchMe(): Promise<Me | null>`

- [ ] **Step 1: Write the Me helper**

Create `apps/admin/src/lib/me.ts`:

```ts
import { apiFetch } from './api'

export interface Me {
  id: string
  name: string
  email: string
  role: string | null
  roleKey: string | null
  permissions: string[]
}

export async function fetchMe(): Promise<Me | null> {
  const { data } = await apiFetch<Me>('/admin/me')
  return data ?? null
}
```

- [ ] **Step 2: Route to change-password on forced first login**

In `apps/admin/src/app/login/page.tsx`, update the `LoginResponse` interface and the post-login branch:

```ts
interface LoginResponse {
  access_token: string
  admin: { name: string; role: string }
  mustChangePassword?: boolean
}
```

and after `saveToken(data!.access_token)`:

```ts
    saveToken(data!.access_token)
    router.push(data!.mustChangePassword ? '/change-password' : '/dashboard')
```

- [ ] **Step 3: Write the change-password page**

Create `apps/admin/src/app/change-password/page.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { isAuthenticated } from '@/lib/auth'

export default function ChangePasswordPage() {
  const router = useRouter()
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNew] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (typeof window !== 'undefined' && !isAuthenticated()) {
    router.replace('/login')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (newPassword !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    const { error: err } = await apiFetch('/admin/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    router.push('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-2xl font-bold text-center">Set a new password</h1>
        <p className="mb-8 text-center text-gray-400 text-sm">Choose a password before continuing.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="password" placeholder="Current password" value={currentPassword} onChange={e => setCurrent(e.target.value)}
            className="w-full rounded bg-gray-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500" required />
          <input type="password" placeholder="New password" value={newPassword} onChange={e => setNew(e.target.value)}
            className="w-full rounded bg-gray-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500" required />
          <input type="password" placeholder="Confirm new password" value={confirm} onChange={e => setConfirm(e.target.value)}
            className="w-full rounded bg-gray-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500" required />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full rounded bg-blue-600 py-2 font-semibold hover:bg-blue-500 disabled:opacity-50">
            {loading ? 'Saving...' : 'Save password'}
          </button>
        </form>
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Typecheck the admin app**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib/me.ts apps/admin/src/app/change-password/page.tsx apps/admin/src/app/login/page.tsx
git commit -m "feat(admin): forced password change flow + Me helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Admin app — Staff tab (staff, roles, LDAP)

**Files:**
- Create: `apps/admin/src/components/StaffTab.tsx`

**Interfaces:**
- Consumes: `apiFetch`. Self-contained; renders staff list, add/edit/suspend/reset modals, roles editor, and an LDAP config card.

- [ ] **Step 1: Write the StaffTab component**

Create `apps/admin/src/components/StaffTab.tsx`:

```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface StaffRow {
  id: string; name: string; email: string; status: string
  auth_provider: string; last_login_at: string | null
  role_id: string | null; role_name: string | null; role_key: string | null
}
interface Role {
  id: string; key: string; name: string; description: string | null
  isSystem: boolean; locked: boolean; permissions: string[]
}
interface CatalogGroup { area: string; label: string; permissions: { key: string; label: string }[] }

export function StaffTab() {
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [catalog, setCatalog] = useState<CatalogGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [section, setSection] = useState<'staff' | 'roles' | 'ldap'>('staff')

  const load = useCallback(async () => {
    setLoading(true)
    const [s, r, c] = await Promise.all([
      apiFetch<{ staff: StaffRow[] }>('/admin/staff'),
      apiFetch<{ roles: Role[] }>('/admin/roles'),
      apiFetch<{ catalog: CatalogGroup[] }>('/admin/permissions-catalog'),
    ])
    if (s.data) setStaff(s.data.staff)
    if (r.data) setRoles(r.data.roles)
    if (c.data) setCatalog(c.data.catalog)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(null), 3000) }

  if (loading) return <div className="text-gray-500 py-10 text-center">Loading staff...</div>

  return (
    <div className="space-y-6">
      {msg && <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-cyan-300">{msg}</div>}
      <div className="flex gap-1 border-b border-gray-800">
        {(['staff', 'roles', 'ldap'] as const).map(t => (
          <button key={t} onClick={() => setSection(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px ${section === t ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            {t === 'ldap' ? 'Directory / SSO' : t}
          </button>
        ))}
      </div>

      {section === 'staff' && <StaffSection staff={staff} roles={roles} reload={load} flash={flash} />}
      {section === 'roles' && <RolesSection roles={roles} catalog={catalog} reload={load} flash={flash} />}
      {section === 'ldap' && <LdapSection roles={roles} flash={flash} />}
    </div>
  )
}

function StaffSection({ staff, roles, reload, flash }: { staff: StaffRow[]; roles: Role[]; reload: () => Promise<void>; flash: (m: string) => void }) {
  const [form, setForm] = useState({ name: '', email: '', roleId: '', password: '' })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy('create')
    const { error } = await apiFetch('/admin/staff', { method: 'POST', body: JSON.stringify(form) })
    setBusy(null)
    if (error) { flash(error.message); return }
    setForm({ name: '', email: '', roleId: '', password: '' }); setOpen(false)
    flash('Staff created.'); await reload()
  }

  async function setStatus(id: string, status: string) {
    setBusy(id + status)
    const { error } = await apiFetch(`/admin/staff/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) })
    setBusy(null)
    if (error) { flash(error.message); return }
    await reload()
  }

  async function changeRole(id: string, roleId: string) {
    const { error } = await apiFetch(`/admin/staff/${id}`, { method: 'PUT', body: JSON.stringify({ roleId }) })
    if (error) { flash(error.message); return }
    flash('Role updated.'); await reload()
  }

  async function resetPw(id: string) {
    const pw = prompt('Enter a temporary password (min 8 chars). The user must change it at next login.')
    if (!pw) return
    const { error } = await apiFetch(`/admin/staff/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password: pw }) })
    flash(error ? error.message : 'Password reset.')
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
            <th className="text-left px-4 py-3">Name</th><th className="text-left px-4 py-3">Email</th>
            <th className="text-left px-4 py-3">Role</th><th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Last login</th><th className="text-left px-4 py-3">Actions</th>
          </tr></thead>
          <tbody>
            {staff.map(s => (
              <tr key={s.id} className="border-b border-gray-800/50">
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3 text-gray-400">{s.email}</td>
                <td className="px-4 py-3">
                  <select value={s.role_id ?? ''} onChange={e => changeRole(s.id, e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs">
                    {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <span className={s.status === 'active' ? 'text-green-400' : 'text-red-400'}>{s.status}</span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{s.last_login_at ? new Date(s.last_login_at).toLocaleString() : 'never'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-3 text-xs">
                    <button onClick={() => setStatus(s.id, s.status === 'active' ? 'suspended' : 'active')}
                      disabled={busy === s.id + (s.status === 'active' ? 'suspended' : 'active')}
                      className="text-yellow-400 hover:text-yellow-300 disabled:opacity-50">
                      {s.status === 'active' ? 'Suspend' : 'Activate'}
                    </button>
                    <button onClick={() => resetPw(s.id)} className="text-cyan-400 hover:text-cyan-300">Reset password</button>
                  </div>
                </td>
              </tr>
            ))}
            {staff.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">No staff yet</td></tr>}
          </tbody>
        </table>
      </div>

      <button onClick={() => setOpen(o => !o)} className="text-sm text-cyan-400 hover:text-cyan-300">
        {open ? 'Cancel' : '+ Add staff'}
      </button>

      {open && (
        <form onSubmit={create} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3 max-w-md">
          <input required placeholder="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          <input required type="email" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          <select required value={form.roleId} onChange={e => setForm({ ...form, roleId: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="">Select a role...</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input required type="text" placeholder="Temporary password (min 8)" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          <p className="text-xs text-gray-500">The staff member will be asked to change this at first login.</p>
          <button type="submit" disabled={busy === 'create'}
            className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm py-2 rounded-lg">
            {busy === 'create' ? 'Creating...' : 'Create staff'}
          </button>
        </form>
      )}
    </div>
  )
}

function RolesSection({ roles, catalog, reload, flash }: { roles: Role[]; catalog: CatalogGroup[]; reload: () => Promise<void>; flash: (m: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [newRole, setNewRole] = useState({ key: '', name: '', description: '' })

  const selected = roles.find(r => r.id === selectedId) ?? null

  function pick(r: Role) {
    setSelectedId(r.id); setCreating(false); setDraft(new Set(r.permissions))
  }
  function toggle(key: string) {
    setDraft(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  async function saveEdit() {
    if (!selected) return
    const { error } = await apiFetch(`/admin/roles/${selected.id}`, { method: 'PUT', body: JSON.stringify({ permissions: Array.from(draft) }) })
    if (error) { flash(error.message); return }
    flash('Role updated.'); await reload()
  }

  async function createRole(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await apiFetch('/admin/roles', { method: 'POST', body: JSON.stringify({ ...newRole, permissions: Array.from(draft) }) })
    if (error) { flash(error.message); return }
    flash('Role created.'); setCreating(false); setNewRole({ key: '', name: '', description: '' }); setDraft(new Set()); await reload()
  }

  async function del(r: Role) {
    if (!confirm(`Delete role "${r.name}"?`)) return
    const { error } = await apiFetch(`/admin/roles/${r.id}`, { method: 'DELETE' })
    if (error) { flash(error.message); return }
    flash('Role deleted.'); setSelectedId(null); await reload()
  }

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="space-y-2">
        {roles.map(r => (
          <div key={r.id} className={`rounded-lg border px-3 py-2 cursor-pointer ${selectedId === r.id ? 'border-cyan-500 bg-gray-800' : 'border-gray-800 bg-gray-900 hover:border-gray-700'}`}
            onClick={() => pick(r)}>
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{r.name}</span>
              {r.locked ? <span className="text-[10px] text-gray-500 uppercase">locked</span>
                : !r.isSystem ? <button onClick={e => { e.stopPropagation(); del(r) }} className="text-[10px] text-red-400 hover:text-red-300">delete</button>
                : <span className="text-[10px] text-gray-600 uppercase">system</span>}
            </div>
            <p className="text-xs text-gray-500">{r.permissions.length} permissions</p>
          </div>
        ))}
        <button onClick={() => { setCreating(true); setSelectedId(null); setDraft(new Set()) }}
          className="w-full text-sm text-cyan-400 hover:text-cyan-300 py-2">+ New role</button>
      </div>

      <div className="md:col-span-2">
        {creating ? (
          <form onSubmit={createRole} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <input required placeholder="key (e.g. ops)" value={newRole.key} onChange={e => setNewRole({ ...newRole, key: e.target.value })}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              <input required placeholder="Name" value={newRole.name} onChange={e => setNewRole({ ...newRole, name: e.target.value })}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <input placeholder="Description" value={newRole.description} onChange={e => setNewRole({ ...newRole, description: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <PermissionGrid catalog={catalog} draft={draft} toggle={toggle} disabled={false} />
            <button type="submit" className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm py-2 px-4 rounded-lg">Create role</button>
          </form>
        ) : selected ? (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold">{selected.name}</h3>
              <p className="text-xs text-gray-500">{selected.description}</p>
            </div>
            <PermissionGrid catalog={catalog} draft={draft} toggle={toggle} disabled={selected.locked} />
            {!selected.locked && (
              <button onClick={saveEdit} className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm py-2 px-4 rounded-lg">Save permissions</button>
            )}
            {selected.locked && <p className="text-xs text-gray-500">Super Admin always has every permission and cannot be edited.</p>}
          </div>
        ) : (
          <p className="text-gray-600 text-sm">Select a role to edit its permissions, or create a new one.</p>
        )}
      </div>
    </div>
  )
}

function PermissionGrid({ catalog, draft, toggle, disabled }: { catalog: CatalogGroup[]; draft: Set<string>; toggle: (k: string) => void; disabled: boolean }) {
  return (
    <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
      {catalog.map(g => (
        <div key={g.area}>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{g.label}</p>
          <div className="grid grid-cols-2 gap-1">
            {g.permissions.map(p => (
              <label key={p.key} className={`flex items-center gap-2 text-xs ${disabled ? 'text-gray-600' : 'text-gray-300'}`}>
                <input type="checkbox" disabled={disabled} checked={draft.has(p.key)} onChange={() => toggle(p.key)} />
                {p.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function LdapSection({ roles, flash }: { roles: Role[]; flash: (m: string) => void }) {
  const [cfg, setCfg] = useState({
    enabled: false, host: '', port: 636, useTls: true, baseDN: '', bindDN: '',
    bindPassword: '', userFilter: '(mail={{login}})', groupAttribute: 'memberOf',
    groupRoleMap: {} as Record<string, string>, hasBindPassword: false,
  })
  const [mapText, setMapText] = useState('')

  useEffect(() => {
    apiFetch<{ config: typeof cfg }>('/admin/ldap-config').then(({ data }) => {
      if (data?.config) {
        setCfg(data.config)
        setMapText(Object.entries(data.config.groupRoleMap || {}).map(([g, r]) => `${g} = ${r}`).join('\n'))
      }
    })
  }, [])

  async function save() {
    const groupRoleMap: Record<string, string> = {}
    for (const line of mapText.split('\n')) {
      const [g, r] = line.split('=').map(s => s.trim())
      if (g && r) groupRoleMap[g] = r
    }
    const body: Record<string, unknown> = { ...cfg, groupRoleMap }
    if (!cfg.bindPassword) delete body.bindPassword // keep stored secret
    delete (body as { hasBindPassword?: boolean }).hasBindPassword
    const { error } = await apiFetch('/admin/ldap-config', { method: 'PUT', body: JSON.stringify(body) })
    flash(error ? error.message : 'Directory settings saved.')
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg px-4 py-2 text-xs text-yellow-300">
        Directory / SSO login. The bind module is ready but stays inactive until you enable it below and point it at a directory. Day-to-day login uses local passwords.
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cfg.enabled} onChange={e => setCfg({ ...cfg, enabled: e.target.checked })} />
        Enable LDAP authentication
      </label>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <input placeholder="Host" value={cfg.host} onChange={e => setCfg({ ...cfg, host: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2" />
        <input type="number" placeholder="Port" value={cfg.port} onChange={e => setCfg({ ...cfg, port: Number(e.target.value) })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2" />
        <input placeholder="Base DN" value={cfg.baseDN} onChange={e => setCfg({ ...cfg, baseDN: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 col-span-2" />
        <input placeholder="Bind DN (service account)" value={cfg.bindDN} onChange={e => setCfg({ ...cfg, bindDN: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 col-span-2" />
        <input type="password" placeholder={cfg.hasBindPassword ? 'Bind password (stored - leave blank to keep)' : 'Bind password'} value={cfg.bindPassword} onChange={e => setCfg({ ...cfg, bindPassword: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 col-span-2" />
        <input placeholder="User filter" value={cfg.userFilter} onChange={e => setCfg({ ...cfg, userFilter: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2" />
        <input placeholder="Group attribute" value={cfg.groupAttribute} onChange={e => setCfg({ ...cfg, groupAttribute: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2" />
      </div>
      <div>
        <label className="text-xs text-gray-400 block mb-1">Group to role map (one per line: <code>ldap-group = role-key</code>)</label>
        <textarea rows={4} value={mapText} onChange={e => setMapText(e.target.value)}
          placeholder={"cn=Finance,dc=example,dc=com = finance"}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono" />
        <p className="text-xs text-gray-600 mt-1">Valid role keys: {roles.map(r => r.key).join(', ')}</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cfg.useTls} onChange={e => setCfg({ ...cfg, useTls: e.target.checked })} />
        Use TLS (ldaps)
      </label>
      <button onClick={save} className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm py-2 px-4 rounded-lg">Save directory settings</button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/components/StaffTab.tsx
git commit -m "feat(admin): Staff tab (staff, roles editor, LDAP config)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Wire Staff tab + permission-driven tab visibility

**Files:**
- Modify: `apps/admin/src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `fetchMe` / `Me` from `@/lib/me`, `StaffTab` from `@/components/StaffTab`.

- [ ] **Step 1: Import Me + StaffTab**

In `apps/admin/src/app/dashboard/page.tsx`, add near the other imports:

```ts
import { StaffTab } from '@/components/StaffTab'
import { fetchMe, type Me } from '@/lib/me'
```

- [ ] **Step 2: Add `me` state + tab->permission map + visible-tab filter**

Add the tab type `'staff'` to the `tab` union, add `me` state, fetch it on mount, and compute visible tabs.

Change the `tab` state declaration to include `staff`:

```ts
  const [tab, setTab] = useState<'stats' | 'promotions' | 'payments' | 'integrations' | 'users' | 'transactions' | 'withdrawals' | 'reconciliation' | 'chat' | 'settings' | 'staff'>('stats')
  const [me, setMe] = useState<Me | null>(null)
```

Add this constant above the component (module scope):

```ts
const TAB_PERMISSION: Record<string, string> = {
  stats: 'stats.view', promotions: 'promotions.view', payments: 'payments.view',
  integrations: 'integrations.view', users: 'players.view', transactions: 'transactions.view',
  withdrawals: 'withdrawals.view', reconciliation: 'reconciliation.view', chat: 'chat.view',
  settings: 'settings.view', staff: 'staff.view',
}
const ALL_TABS = ['stats', 'promotions', 'payments', 'integrations', 'users', 'transactions', 'withdrawals', 'reconciliation', 'chat', 'settings', 'staff'] as const
```

In the mount `useEffect` (the one that checks `isAuthenticated`), after `fetchStats()`:

```ts
    fetchMe().then(m => {
      setMe(m)
      // If the current tab is not permitted, jump to the first permitted tab.
      if (m && !m.permissions.includes(TAB_PERMISSION['stats'])) {
        const first = ALL_TABS.find(t => m.permissions.includes(TAB_PERMISSION[t]))
        if (first) setTab(first)
      }
    })
```

- [ ] **Step 3: Filter the rendered tab bar by permission**

Replace the hardcoded tab array in the tab bar with a permission-filtered list. Find:

```ts
        {(['stats', 'promotions', 'payments', 'integrations', 'users', 'transactions', 'withdrawals', 'reconciliation', 'chat', 'settings'] as const).map(t => {
```

Replace with:

```ts
        {ALL_TABS.filter(t => !me || me.permissions.includes(TAB_PERMISSION[t])).map(t => {
```

- [ ] **Step 4: Render the Staff tab panel**

After the `{tab === 'settings' && <GameSettingsTab />}` line, add:

```tsx
      {tab === 'staff' && <StaffTab />}
```

- [ ] **Step 5: Typecheck + compile the admin app**

Run: `cd apps/admin && npx tsc --noEmit`
Then a route compile smoke: `cd apps/admin && (npx next dev -p 3997 & sleep 30; curl -s -o /dev/null -w '%{http_code}' http://localhost:3997/dashboard; kill %1)`
Expected: no type errors; dashboard returns 200 (it will redirect client-side to /login without a token, which still compiles/serves 200).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/app/dashboard/page.tsx
git commit -m "feat(admin): permission-driven tabs + Staff tab wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Full verification + deploy

**Files:** none (verification/deploy).

- [ ] **Step 1: Full API test suite + typecheck**

Run: `cd apps/api && npx vitest run && npx tsc --noEmit`
Expected: all green (including existing chat/withdrawals/admin-auth tests, updated for the retrofit).

- [ ] **Step 2: Admin app typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit any test fixups**

If Steps 1-2 required test/mocks changes, commit them:

```bash
git add -A
git commit -m "test: align existing admin tests with RBAC retrofit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Push + deploy API then Admin (Render)**

```bash
git push origin master
```

Then trigger deploys (API first so the migration runs, then Admin), using `RENDER_API_KEY` from `.env`:

```bash
KEY=$(grep -E "^RENDER_API_KEY=" .env | cut -d= -f2- | tr -d '"'"'"'\r')
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  "https://api.render.com/v1/services/srv-d7eb279o3t8c73ebvvdg/deploys" -d '{"clearCache":"do_not_clear"}'
# after API is live:
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  "https://api.render.com/v1/services/srv-d7ee004vikkc73enkl40/deploys" -d '{"clearCache":"do_not_clear"}'
```

Poll each deploy's status until `live` (see prior deploy pattern in the repo history).

- [ ] **Step 5: Prod smoke (auth-gated; expect 401 unauthenticated)**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://wingubid-api.onrender.com/admin/staff        # expect 401
curl -s -o /dev/null -w '%{http_code}\n' https://wingubid-api.onrender.com/admin/permissions-catalog  # expect 401
```

Expected: `401` (route exists, auth required). Confirm the migration applied by checking the API deploy logs for `applied 036_staff_rbac.sql`.

- [ ] **Step 6: Manual UI verification (owner-driven, documented)**

Log into the admin app as the seeded super admin, open the **Staff** tab, and:
1. Create a test staff member with the Finance role + temp password.
2. Log in as that user in a private window; confirm the forced password-change screen appears and that only permitted tabs show after changing it.
3. Edit the Finance role to grant `withdrawals.approve`; confirm the change takes effect without re-login (within ~30s cache TTL).
4. Suspend the test user; confirm they can no longer log in.

Note: this step is manual because admin UI is login-gated and cannot be driven headlessly here.

---

## Self-Review Notes

- **Spec coverage:** schema (Task 1), catalog (Task 2), enforcement service + middleware (Tasks 3-4), real dormant LDAP module + config (Tasks 5-6), auth seam + login (Task 7), staff routes + guardrails + ldap-config (Task 8), roles CRUD + catalog endpoint (Task 9), /admin/me + change-password + registration (Task 10), retrofit chat/withdrawals (Task 11), forced-password-change UI (Task 12), Staff tab UI (Task 13), tab visibility (Task 14), verify + deploy (Task 15). All spec sections map to a task.
- **Guardrails:** last-active-super-admin protected on suspend + role-change (Task 8); role-in-use + system-role delete protection and super_admin lock (Task 9).
- **Type consistency:** `getPermissionsForAdmin`/`invalidatePermissionsCache` names consistent across Tasks 3, 4, 8, 9, 10, 11 mocks; `LdapConfig` fields consistent across Tasks 5, 6, 8, 13; `Me` shape consistent across Tasks 10, 12, 14.
- **Known trade-off:** JWT still carries the role key; a role *reassignment* for an already-logged-in user takes effect on their next login/token refresh (4h expiry), while *permission edits to a role* take effect within the 30s cache TTL because permissions are looked up live by role. This matches the spec's "editing a role takes effect without re-login."
