# Tax Admin Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permission-gated Taxes tab to the admin dashboard to view/edit the per-country wager_tax and withdrawal_tax rates (existing `tax_rules` table).

**Architecture:** New `taxes` permission area (auto-granted to super_admin); new `/admin/tax-rules` GET/PUT routes (requirePermission-gated) over the existing table; a new TaxesTab wired into the dashboard.

**Tech Stack:** Fastify + `@betting/db` (raw SQL), Zod, Vitest (API); Next.js 14 + Tailwind (admin).

## Global Constraints

- No DB migration (`tax_rules` exists, `UNIQUE(country, tax_type)`).
- Financial control: gate API with `requirePermission` (`taxes.view` for GET, `taxes.edit` for PUT), after `authenticateAdmin`.
- Do NOT change tax calculation (`tax.service.calculateTax`) or when tax is applied.
- API error shape `{ error: { code, message } }`. ESM `.js` imports. No em-dashes.
- Commit trailer (verbatim last line): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Tests: API `cd apps/api && npx vitest run <path>` + `npx tsc --noEmit`; admin `npx tsc --noEmit`.
- Countries: KE, UG, TZ, RW. Tax types: wager_tax, withdrawal_tax.

## File Structure

**API (create):** `apps/api/src/routes/admin/tax.ts` (+ `tax.test.ts`).
**API (modify):** `apps/api/src/lib/permissions.ts` (add taxes area), `apps/api/src/server.ts` (register route).
**Admin (create):** `apps/admin/src/components/TaxesTab.tsx`.
**Admin (modify):** `apps/admin/src/app/dashboard/page.tsx` (wire the tab).

---

## Task 1: Permission area + tax routes

**Files:** Modify `apps/api/src/lib/permissions.ts`, `apps/api/src/server.ts`; Create `apps/api/src/routes/admin/tax.ts` (+ `apps/api/src/routes/admin/tax.test.ts`)
**Interfaces:** Produces `GET /admin/tax-rules` and `PUT /admin/tax-rules`.

- [ ] **Step 1: Add the permission area.** In `apps/api/src/lib/permissions.ts`, add to `PERMISSION_CATALOG` (after the `campaigns` area, before `staff`, or anywhere in the list):

```ts
  { area: 'taxes', label: 'Taxes', permissions: [
    { key: 'taxes.view', label: 'View tax rules' },
    { key: 'taxes.edit', label: 'Edit tax rules' },
  ] },
```
(`ALL_PERMISSION_KEYS` derives from the catalog and `super_admin` auto-resolves every key, so no other permission change is needed.)

- [ ] **Step 2: Write failing route tests.**

Create `apps/api/src/routes/admin/tax.test.ts`. Read an existing admin route test that uses `requirePermission` (e.g. `apps/api/src/routes/admin/campaigns.test.ts`) to copy the exact mock setup for `authenticateAdmin`, `requirePermission` (or `permissions.service.getPermissionsForAdmin`), `@betting/db` pool, and `buildServer`. Cover:
- `GET /admin/tax-rules` with `taxes.view` returns `{ rules: [...] }` mapped from mocked rows.
- `GET` without `taxes.view` -> 403.
- `PUT /admin/tax-rules` with `taxes.edit` and a valid body issues the upsert (assert the `INSERT ... ON CONFLICT (country, tax_type) DO UPDATE` SQL + params) and returns `{ ok: true }`.
- `PUT` without `taxes.edit` -> 403.
- `PUT` with invalid body (country not in enum, taxType invalid, rate 150 or -1, enabled non-boolean) -> 400 VALIDATION_ERROR.

- [ ] **Step 3: Run to verify fail**.

- [ ] **Step 4: Implement the routes.** Create `apps/api/src/routes/admin/tax.ts`:

```ts
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { requirePermission } from '../../middleware/requirePermission.js'

const putBody = z.object({
  country: z.enum(['KE', 'UG', 'TZ', 'RW']),
  taxType: z.enum(['wager_tax', 'withdrawal_tax']),
  rate: z.number().min(0).max(100),
  enabled: z.boolean(),
})

export async function adminTaxRoutes(app: FastifyInstance) {
  app.get('/admin/tax-rules', { preHandler: [authenticateAdmin, requirePermission('taxes.view')] }, async (_req, reply) => {
    const { rows } = await pool.query<{ country: string; tax_type: string; rate: string; enabled: boolean }>(
      `SELECT country, tax_type, rate, enabled FROM tax_rules ORDER BY country, tax_type`,
    )
    return reply.send({ rules: rows.map(r => ({
      country: r.country, taxType: r.tax_type, rate: Number(r.rate), enabled: r.enabled,
    })) })
  })

  app.put('/admin/tax-rules', { preHandler: [authenticateAdmin, requirePermission('taxes.edit')] }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    const d = parsed.data
    await pool.query(
      `INSERT INTO tax_rules (country, tax_type, rate, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (country, tax_type) DO UPDATE SET rate = EXCLUDED.rate, enabled = EXCLUDED.enabled`,
      [d.country, d.taxType, d.rate, d.enabled],
    )
    return reply.send({ ok: true })
  })
}
```
(Confirm the actual `requirePermission` import path by reading `apps/api/src/middleware/requirePermission.ts`; the file exists there per the codebase.)

- [ ] **Step 5: Register the route.** In `apps/api/src/server.ts`, import `adminTaxRoutes` and `app.register(adminTaxRoutes)` alongside the other admin routes (e.g. near `adminGameSettingsRoutes`).

- [ ] **Step 6: Run tests + full suite + tsc** — `cd apps/api && npx vitest run src/routes/admin/tax.test.ts && npx vitest run && npx tsc --noEmit`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/permissions.ts apps/api/src/routes/admin/tax.ts apps/api/src/routes/admin/tax.test.ts apps/api/src/server.ts
git commit -m "feat(api): admin tax-rules routes + taxes permission

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Admin Taxes tab

**Files:** Create `apps/admin/src/components/TaxesTab.tsx`; Modify `apps/admin/src/app/dashboard/page.tsx`

- [ ] **Step 1: Build TaxesTab.** Read `apps/admin/src/components/GameSettingsTab.tsx` for the styling + the `@/lib/api` `apiFetch` `{data,error}` pattern. Create `TaxesTab.tsx`:
  - State: `rules` (array of `{ country, taxType, rate, enabled }`), loading, a per-row saving flag, and a message.
  - On mount: `apiFetch<{ rules: {...}[] }>('/admin/tax-rules')`.
  - Render grouped by country (KE, UG, TZ, RW). For each country show its two tax types (wager_tax "Wager tax (on stakes)", withdrawal_tax "Withdrawal tax") each with: a number input for rate (%) (step 0.01, min 0, max 100), an enabled toggle/checkbox, and a Save button.
  - Save: `apiFetch('/admin/tax-rules', { method: 'PUT', body: JSON.stringify({ country, taxType, rate: Number(rate), enabled }) })`; on success show "Saved", on error surface `error.message` (a 403 from a view-only admin shows the friendly FORBIDDEN message).
  - Dark-theme Tailwind consistent with GameSettingsTab. No em-dashes.

- [ ] **Step 2: Wire the tab into the dashboard.** In `apps/admin/src/app/dashboard/page.tsx`:
  - Import `TaxesTab` from `@/components/TaxesTab`.
  - Add `'taxes'` to the `ALL_TABS` array (place it right after `'settings'`).
  - Add `taxes: 'taxes.view'` to the `TAB_PERMISSION` map.
  - Add `'taxes'` to the `tab` state union type (`useState<'stats' | ... | 'taxes'>`).
  - Add a render branch near the other tabs: `{tab === 'taxes' && <TaxesTab />}`.
  (The nav already filters tabs by `me.permissions.includes(TAB_PERMISSION[t])`, so the tab auto-hides for admins without `taxes.view`, and super_admin sees it.)

- [ ] **Step 3: Typecheck** — `cd apps/admin && npx tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/components/TaxesTab.tsx apps/admin/src/app/dashboard/page.tsx
git commit -m "feat(admin): Taxes tab for per-country wager/withdrawal rates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Verify + deploy

- [ ] **Step 1:** `cd apps/api && npx vitest run && npx tsc --noEmit` (green).
- [ ] **Step 2:** `cd apps/admin && npx tsc --noEmit` (clean).
- [ ] **Step 3:** Merge branch to master; push. Deploy API (`srv-d7eb279o3t8c73ebvvdg`) then Admin (`srv-d7ee004vikkc73enkl40`). Capture deploy ids, poll to `live`.
- [ ] **Step 4:** Prod smoke: API `/health` 200; `GET /admin/tax-rules` 401 unauth; admin app loads 200; (manual) super_admin sees the Taxes tab and can edit the KE rate.

---

## Self-Review Notes

- **Spec coverage:** taxes permission area + GET/PUT routes + register (Task 1); TaxesTab + dashboard wiring (Task 2); verify+deploy (Task 3). All mapped.
- **Type consistency:** route returns `{ rules: [{ country, taxType, rate, enabled }] }` consumed by TaxesTab; PUT body `{ country, taxType, rate, enabled }` matches the zod schema; `TAB_PERMISSION.taxes = 'taxes.view'` matches the catalog key; tab string `'taxes'` consistent in ALL_TABS + union + render.
- **Safety:** requirePermission gates both routes server-side (not UI-only); super_admin auto-granted via catalog; upsert respects UNIQUE(country, tax_type); no schema change; tax calculation untouched.
