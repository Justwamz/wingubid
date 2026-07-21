# Staff management + roles & permissions (RBAC) — design

**Date:** 2026-07-21
**Status:** Approved for planning

## Problem

There is no way to create staff accounts or change what a role can do. Today
`admin_users.role` is a fixed 4-value enum (`super_admin | finance | support |
reports`), and permissions are hardcoded per route (e.g. chat moderation checks
`['support','super_admin']`, withdrawal approval checks `['finance',
'super_admin']`). Only one super-admin is seeded. Adding staff or adjusting
capabilities requires a code change and deploy.

## Goal

Let a super admin (or anyone granted the right permission) create staff members,
assign them roles, and edit what each role can do — from the admin UI, no deploy.
Build the authentication layer with a pluggable provider seam so LDAP/AD can be
enabled later without rework.

## Decisions (locked)

- **Model:** custom RBAC with editable roles; seed default roles **Super Admin,
  Finance, Risk, Support**.
- **Granularity:** fine-grained, per-action permissions.
- **Managing staff/roles:** governed by assignable permissions
  (`staff.*`, `roles.*`), which Super Admin holds by default.
- **Onboarding:** super admin sets an initial password; staff is forced to
  change it on first login. (Transactional email is not wired yet.)
- **LDAP:** design the seam + store config now, but keep it dormant (local
  password auth day 1). No LDAP npm dependency added yet.
- **Default grants:** start minimal — each seeded role gets only `stats.view` +
  its own area's view permission; super admin configures the rest in the UI.

## Data model — migration `036_staff_rbac.sql`

```sql
CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         VARCHAR(40) UNIQUE NOT NULL,      -- slug, e.g. 'finance'
  name        VARCHAR(80) NOT NULL,
  description VARCHAR(255),
  is_system   BOOLEAN NOT NULL DEFAULT false,   -- protects seeded roles from delete
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE role_permissions (
  role_id        UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key VARCHAR(60) NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

-- admin_users changes
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check; -- name may vary; drop the CHECK on role
ALTER TABLE admin_users
  ADD COLUMN role_id UUID REFERENCES roles(id),
  ADD COLUMN auth_provider VARCHAR(10) NOT NULL DEFAULT 'local'
    CHECK (auth_provider IN ('local','ldap')),
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN created_by UUID REFERENCES admin_users(id),
  ADD COLUMN last_login_at TIMESTAMPTZ;
```

Seed data (idempotent, `ON CONFLICT (key) DO NOTHING` for roles):
- Roles: `super_admin` (is_system, name "Super Admin"), `finance`, `risk`,
  `support` (all is_system).
- `role_permissions`:
  - super_admin: wildcard handled in code (not stored as rows) — super_admin
    always passes every check. Optionally store the sentinel `*`; code treats
    role key `super_admin` as all-access regardless.
  - finance: `stats.view`, `withdrawals.view`, `transactions.view`
  - risk: `stats.view`, `settings.view`, `chat.view`
  - support: `stats.view`, `players.view`, `chat.view`
- Backfill: set `admin_users.role_id` from the matching `roles.key` = existing
  `role` string. The seeded super admin maps to the `super_admin` role.
- Keep the `role` column as a **denormalized role key** (no longer constrained to
  4 values), kept in sync on assignment, so the login path can sign it into the
  JWT and existing display code keeps working.

> Note: legacy role `reports` has no seeded role. If any `admin_users.role =
> 'reports'` exists, create a `reports` role (is_system=false) seeded with
> `stats.view` during migration so the backfill FK resolves. (Current prod has
> only the super_admin seed, so this is defensive.)

## Permission catalog (code-defined, source of truth)

Lives in `apps/api/src/lib/permissions.ts` as a grouped constant and is exposed
to the UI via `GET /admin/permissions-catalog`. `role_permissions` rows are
validated against this catalog on write.

```
stats:          stats.view
players:        players.view, players.edit, players.suspend,
                players.adjust_balance, players.export
transactions:   transactions.view, transactions.export, transactions.dispute
withdrawals:    withdrawals.view, withdrawals.approve, withdrawals.reject,
                withdrawals.config
reconciliation: reconciliation.view, reconciliation.resolve
payments:       payments.view, payments.edit
integrations:   integrations.view, integrations.edit
promotions:     promotions.view, promotions.create, promotions.edit,
                promotions.delete, promotions.activate
chat:           chat.view, chat.moderate, chat.config, chat.words,
                chat.reset_username
settings:       settings.view, settings.edit
staff:          staff.view, staff.create, staff.edit, staff.suspend,
                staff.reset_password
roles:          roles.view, roles.create, roles.edit, roles.delete
```

`super_admin` = all keys, including any added in future releases (wildcard in
code). The super_admin role is locked: its permission set cannot be edited and
the role cannot be deleted.

## Enforcement

- `apps/api/src/services/permissions.service.ts`:
  `getPermissionsForRole(roleId)` returns a `Set<string>` of granted keys,
  cached in-memory ~60s per role; `invalidatePermissionsCache(roleId?)` called on
  any role edit. A role whose key is `super_admin` resolves to "all".
- `apps/api/src/middleware/requirePermission.ts`: factory
  `requirePermission(key)` returning a Fastify preHandler that runs after
  `authenticateAdmin`, loads the caller's permission set by `role_id`, and 403s
  (`FORBIDDEN`) if the key is absent. Composed as
  `{ preHandler: [authenticateAdmin, requirePermission('withdrawals.approve')] }`.
- `authenticateAdmin` additionally resolves and attaches `req.adminRoleId`
  (and keeps `req.adminRole` = role key for the super_admin shortcut + display).
  Permissions are looked up **live** (cached), so editing a role takes effect
  without requiring users to re-login.
- **Retrofit existing checks:**
  - `routes/admin/chat.ts` `requireMod` → `requirePermission('chat.moderate')`
    (config/words actions → `chat.config` / `chat.words`).
  - `routes/admin/withdrawals.ts` `requireApprover` →
    `withdrawals.approve` / `withdrawals.reject`; threshold config →
    `withdrawals.config`.

## Authentication seam (LDAP-ready, local today)

- `apps/api/src/services/staff-auth.service.ts` exposes
  `authenticateStaff(email, password)`:
  1. Load the staff row (incl. `auth_provider`, `status`).
  2. If `auth_provider === 'ldap'` **and** stored `ldap_config.enabled` →
     `ldapBind(email, password)` (from `lib/ldap-auth.ts`) → map an LDAP group to
     a role via `groupRoleMap` → resolve/match `admin_users` by email.
  3. Else → today's local `verifyPassword` path.
- `apps/api/src/lib/ldap-auth.ts`: a clearly-marked **stub** that throws
  `AppError('LDAP_NOT_ENABLED', ...)`. No ldap dependency yet. Documented TODO
  for the real `ldapts` bind.
- LDAP config stored in `game_settings` key `ldap_config`:
  `{ enabled:false, host, port, baseDN, bindDN, userFilter, groupAttribute,
  groupRoleMap: { "<ldap-group>": "<role-key>" } }`. The bind password, if ever
  set, is stored server-side and never returned to the client.
- `loginAdmin` is refactored to call `authenticateStaff`, then sign the JWT
  (unchanged shape: `sub`, `role` key), stamp `last_login_at`, and include
  `mustChangePassword` in the response.

## Password onboarding

- Create staff → caller supplies a temporary password;
  `must_change_password = true`.
- On login, the response carries `mustChangePassword`. The admin app routes to a
  **Change password** screen before the dashboard.
- `POST /admin/change-password` (self, any authenticated staff): verifies current
  password, sets new hash, clears `must_change_password`.
- Manager reset: `POST /admin/staff/:id/reset-password` sets a new temp password
  and `must_change_password = true`.

## API (all under `/admin`, permission-gated; every mutation audited)

| Method + path | Permission | Notes |
|---|---|---|
| `GET /admin/staff` | `staff.view` | list: name, email, role, status, last login, provider |
| `POST /admin/staff` | `staff.create` | `{name,email,roleId,password}`; sets must_change |
| `PUT /admin/staff/:id` | `staff.edit` | update name / roleId |
| `PUT /admin/staff/:id/status` | `staff.suspend` | active/suspended |
| `POST /admin/staff/:id/reset-password` | `staff.reset_password` | `{password}` |
| `GET /admin/roles` | `roles.view` | roles + their permission keys |
| `POST /admin/roles` | `roles.create` | `{key,name,description,permissions[]}` |
| `PUT /admin/roles/:id` | `roles.edit` | name/description/permissions |
| `DELETE /admin/roles/:id` | `roles.delete` | non-system + not in use only |
| `GET /admin/permissions-catalog` | `roles.view` | grouped catalog for the UI |
| `GET /admin/me` | authenticated | profile + effective permission list |
| `POST /admin/change-password` | authenticated | self; clears must_change |

**Guardrails**
- Always keep ≥1 **active** super_admin: block suspend / role-change / (future)
  delete that would remove the last one.
- Can't delete a role that still has staff assigned (reassign first).
- Can't edit the super_admin role's permissions or delete it.
- Validate all permission keys against the catalog on write.
- Email is unique (existing constraint); friendly 409 on duplicate.
- Audit every staff/role mutation into `admin_audit_log`
  (`action`, `entity='staff'|'role'`, `entity_id`, `after`).

## Admin UI

- **New "Staff" tab** (rendered only if the caller has `staff.view`):
  - *Staff* section: table (name, email, role, status, last login) with Add /
    Edit / Suspend / Reset-password actions (modals); role chosen from a dropdown
    of existing roles.
  - *Roles & Permissions* section: role list; an editor with permission
    checkboxes **grouped by area** (from the catalog); create custom role;
    super_admin role shown read-only/locked.
  - *Directory / SSO (LDAP)* card: the `ldap_config` form, clearly labelled
    "Not active — future SSO"; editable + stored but inert.
- **Forced password change** screen when `mustChangePassword` is true (blocks the
  dashboard until changed).
- **Tab visibility from `/admin/me`**: hide any tab whose `.view` permission the
  caller lacks; super admin sees all. Tab→permission map:
  `stats→stats.view, promotions→promotions.view, payments→payments.view,
  integrations→integrations.view, users→players.view,
  transactions→transactions.view, withdrawals→withdrawals.view,
  reconciliation→reconciliation.view, chat→chat.view, settings→settings.view,
  staff→staff.view`.

## Testing

- Unit: `permissions.service` cache + super_admin all-access; `requirePermission`
  allow/deny; last-super-admin guardrail; role-in-use delete guard; catalog-key
  validation.
- Update existing chat/withdrawals route tests for the permission retrofit (the
  test middleware mock should grant all permissions, matching the current
  `role='super'` pattern).
- `staff-auth.service`: local path succeeds; ldap path throws `LDAP_NOT_ENABLED`
  when provider=ldap.

## Out of scope (YAGNI)

- Real LDAP bind (stubbed; enable later).
- Email invites / SMS (super admin sets initial password instead).
- Per-staff permission overrides on top of role (roles only for now).
- Self-service password reset via email.

## Rollout

- Migration runs on API boot (existing `runMigrations()`), including backfill.
- Deploy order: API then Admin. Player web app unaffected.
- Verify: tsc (api + admin), vitest, then prod smoke of `/admin/me`,
  `/admin/staff`, `/admin/roles` behind auth.
