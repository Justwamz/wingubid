# Tax admin tab — design

**Date:** 2026-07-31
**Status:** Approved for planning

## Problem

Tax rates (`tax_rules`: per-country `wager_tax` on stakes + `withdrawal_tax` on
withdrawals) are applied live by `tax.service.ts`, but there is NO admin UI or
admin API to view/change them - editing a rate today is a raw DB operation. Add a
permission-gated **Taxes** tab to the admin dashboard to manage them.

## Decisions (locked)

- New dedicated permission area **`taxes`** with `taxes.view` (see the tab) and
  `taxes.edit` (change rates). Adding it to `PERMISSION_CATALOG` means `super_admin`
  auto-resolves it (getPermissionsForAdmin grants super_admin every catalog key,
  including new ones) and it appears in the Staff roles editor for assigning to
  Finance / other roles. No seed migration.
- Tax API routes are gated by `requirePermission` (stronger than Game Settings'
  auth-only), matching the campaigns/staff pattern - a financial control should not
  rely on UI tab-visibility alone.
- Scope: edit the existing market rows (KE, UG, TZ, RW) x 2 tax types. Upsert by
  `(country, tax_type)` (table has `UNIQUE(country, tax_type)`). No schema change.
- No change to how tax is calculated/applied (`tax.service.calculateTax` unchanged).

## API — `apps/api/src/routes/admin/tax.ts` (new, registered in server.ts)

- `GET /admin/tax-rules` — preHandler `[authenticateAdmin, requirePermission('taxes.view')]`.
  Returns `{ rules: [{ country, taxType, rate, enabled }] }` for all rows,
  ordered by country then tax_type.
- `PUT /admin/tax-rules` — preHandler `[authenticateAdmin, requirePermission('taxes.edit')]`.
  Body `{ country: 'KE'|'UG'|'TZ'|'RW', taxType: 'wager_tax'|'withdrawal_tax', rate: number (0..100), enabled: boolean }`.
  Upsert: `INSERT ... ON CONFLICT (country, tax_type) DO UPDATE SET rate = $, enabled = $`.
  Zod-validate the enums, `rate` 0..100 (2dp), `enabled` boolean. Returns `{ ok: true }`.
- Register `adminTaxRoutes` in `apps/api/src/server.ts` alongside the other admin routes.

## Permissions — `apps/api/src/lib/permissions.ts`

- Add to `PERMISSION_CATALOG`:
  ```
  { area: 'taxes', label: 'Taxes', permissions: [
    { key: 'taxes.view', label: 'View tax rules' },
    { key: 'taxes.edit', label: 'Edit tax rules' },
  ] }
  ```
  `ALL_PERMISSION_KEYS` derives from the catalog, so no other API change is needed.

## Admin UI — `apps/admin/src/app/dashboard/page.tsx` + `apps/admin/src/components/TaxesTab.tsx` (new)

- Dashboard wiring: add `'taxes'` to `ALL_TABS` (placed after `settings`), to the
  `tab` state union type, to `TAB_PERMISSION` (`taxes: 'taxes.view'`), and a render
  branch `{tab === 'taxes' && <TaxesTab />}`. The tab auto-hides for admins lacking
  `taxes.view` (existing `ALL_TABS.filter(... me.permissions.includes ...)` logic).
- `TaxesTab.tsx`: on mount `GET /admin/tax-rules`; render a per-country card/row
  showing both tax types with an editable rate (%) input + enabled toggle. Save
  issues `PUT /admin/tax-rules` per changed row. Show a success/error message.
  Mirror `GameSettingsTab.tsx` styling (dark theme, `@/lib/api` `{data,error}`
  client). Read-only if the admin has `taxes.view` but not `taxes.edit`? Keep simple:
  the tab is shown to `taxes.view` holders; the PUT is separately gated by
  `taxes.edit` server-side, so a view-only admin who edits gets a 403 surfaced as an
  error message (acceptable; optional nicety: disable inputs when the admin lacks
  taxes.edit, using the `me.permissions` already loaded by the dashboard - pass it
  down if convenient, else skip).

## Testing

- API `tax.test.ts`: `GET /admin/tax-rules` returns rows (mock pool); requires
  `taxes.view` (403 without); `PUT` upserts (assert the ON CONFLICT query + params),
  requires `taxes.edit`; validation rejects bad country/taxType/rate (>100, <0)/enabled.
- Permission catalog: a light assertion that `taxes.view`/`taxes.edit` are present
  (or covered via the route tests).
- Admin: tsc; TaxesTab renders + saves (typecheck-gated).

## Rollout

- No migration. Deploy API + Admin. Smoke: `/admin/tax-rules` 401 unauth; admin tab
  visible to super_admin; editing KE rate persists.

## Out of scope

- Adding new countries/markets from the UI (edit existing four only).
- Tax reporting/remittance UI (tables exist; separate feature).
- Changing tax calculation logic or when tax is applied.
