# Banner-campaign Light Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin optionally link a banner to a bonus campaign so the banner's CTA routes to `/rewards` (with the campaign's promo code prefilled), managed in one place.

**Architecture:** Additive `campaign_id` FK on `banners`. Admin API accepts/returns it and serves a campaign-options list; the public banner endpoint derives the CTA destination from the linked campaign; the Rewards page prefills the promo code from `?code=`; the Promotions UI gets a "Link to campaign" dropdown.

**Tech Stack:** Fastify + `@betting/db` (raw SQL), Zod, Vitest (API); Next.js 14 (web + admin).

## Global Constraints

- Additive only; unlinked banners behave exactly as today. No auto-sync (linking only drives the CTA).
- API error shape `{ error: { code, message } }`. ESM `.js` imports. No em-dashes.
- Linked CTA destination overrides the manual `cta_url`; `cta_text` stays admin-controlled.
- `?code=` prefills the Rewards promo input but never auto-submits.
- Commit trailer (verbatim last line): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Tests: API `cd apps/api && npx vitest run <path>` + `npx tsc --noEmit`; admin/web `npx tsc --noEmit`.
- Migration is next number 043.

## File Structure

**API (create):** `packages/db/migrations/043_banner_campaign_link.sql`.
**API (modify):** `apps/api/src/routes/admin/banners.ts` (+ test if present), `apps/api/src/routes/banners/public.ts` (+ test if present).
**Web (modify):** `apps/web/src/app/(player)/rewards/page.tsx`.
**Admin (modify):** `apps/admin/src/app/dashboard/page.tsx` (BannerSection + banner state/types).

---

## Task 1: Migration 043

**Files:** Create `packages/db/migrations/043_banner_campaign_link.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE banners
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES bonus_campaigns(id);
```

- [ ] **Step 2: Typecheck** — `cd apps/api && npx tsc --noEmit`.
- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/043_banner_campaign_link.sql
git commit -m "feat(db): banners.campaign_id link to bonus_campaigns

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Admin banners route - link field, list join, campaign options

**Files:** Modify `apps/api/src/routes/admin/banners.ts` (+ `banners.test.ts` if it exists; else create a minimal one)

- [ ] **Step 1: Write failing tests**

Read the existing test setup (or a sibling admin route test) to match app-build + admin-auth mocking. Cover:
- POST `/admin/banners` with `campaignId` persists it (INSERT param includes the id); without `campaignId` stores null.
- PUT `/admin/banners/:id` with `campaignId: null` clears it; with a value sets it; omitting it leaves it unchanged.
- GET `/admin/banners` returns `campaignId` and `campaignName` (from the join).
- GET `/admin/banners/campaign-options` returns active campaigns `[{ id, name, code }]`.

- [ ] **Step 2: Run to verify fail**.

- [ ] **Step 3: Implement**

In `apps/api/src/routes/admin/banners.ts`:
- Add to `bannerBody`: `campaignId: z.string().uuid().nullish(),` (so `updateBody = bannerBody.partial().omit({ placement: true })` inherits it).
- CREATE INSERT: add `campaign_id` column + param `d.campaignId ?? null`:

```ts
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO banners (placement, headline, subtext, cta_text, cta_url, image_url, gradient, campaign_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [d.placement, d.headline, d.subtext, d.ctaText, d.ctaUrl, d.imageUrl, d.gradient, d.campaignId ?? null],
    )
```
- UPDATE: keep COALESCE for the existing columns, but handle `campaign_id` via presence in the raw body so it can be cleared. Build the query with an optional extra SET:

```ts
    const body = (req.body ?? {}) as Record<string, unknown>
    const sets = [
      'headline  = COALESCE($1, headline)',
      'subtext   = COALESCE($2, subtext)',
      'cta_text  = COALESCE($3, cta_text)',
      'cta_url   = COALESCE($4, cta_url)',
      'image_url = COALESCE($5, image_url)',
      'gradient  = COALESCE($6, gradient)',
      'updated_at = NOW()',
    ]
    const vals: unknown[] = [
      d.headline ?? null, d.subtext ?? null, d.ctaText ?? null,
      d.ctaUrl ?? null, d.imageUrl ?? null, d.gradient ?? null,
    ]
    let n = vals.length // 6
    if ('campaignId' in body) { sets.push(`campaign_id = $${++n}`); vals.push(d.campaignId ?? null) }
    vals.push(id) // id is the last param
    await pool.query(`UPDATE banners SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals)
    return reply.send({ ok: true })
```
(Adapt to the file's exact current param numbering; the key is `campaign_id` is set only when the key is present, and `id` is the final placeholder.)
- GET `/admin/banners` list: LEFT JOIN and return the link:

```ts
    const { rows } = await pool.query(
      `SELECT b.id, b.placement, b.headline, b.subtext, b.cta_text, b.cta_url, b.image_url,
              b.gradient, b.active, b.created_at, b.campaign_id, c.name AS campaign_name
       FROM banners b LEFT JOIN bonus_campaigns c ON c.id = b.campaign_id
       ORDER BY b.placement, b.created_at DESC`,
    )
```
Add `campaignId: r.campaign_id, campaignName: r.campaign_name` to the mapped output.
- New route (place with the other banner routes, `preHandler: authenticateAdmin`):

```ts
  app.get('/admin/banners/campaign-options', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const { rows } = await pool.query<{ id: string; name: string; code: string | null }>(
      `SELECT id, name, code FROM bonus_campaigns WHERE status = 'active' ORDER BY created_at DESC`,
    )
    return reply.send({ campaigns: rows.map(r => ({ id: r.id, name: r.name, code: r.code })) })
  })
```
NOTE: register this GET so it is not shadowed by any `/admin/banners/:id`-style param route (there is none for GET here, but keep the static path before any dynamic GET if added).

- [ ] **Step 4: Run tests + full suite + tsc** — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/banners.ts apps/api/src/routes/admin/banners.test.ts
git commit -m "feat(api): link banners to campaigns + campaign options

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Public banner CTA from linked campaign

**Files:** Modify `apps/api/src/routes/banners/public.ts` (+ its test if present; else create a minimal one)

- [ ] **Step 1: Write failing test**

Add/create a test: a linked banner whose campaign has a code returns `ctaUrl = '/rewards?code=<CODE>'`; a linked campaign with no code returns `/rewards`; an unlinked banner returns its own `cta_url`. Mock the pool query rows accordingly.

- [ ] **Step 2: Implement**

In `getActiveBanner`, join the campaign and derive the CTA:

```ts
  const { rows } = await pool.query<{
    id: string; headline: string; subtext: string; cta_text: string
    cta_url: string; image_url: string; gradient: string
    campaign_id: string | null; campaign_code: string | null
  }>(
    `SELECT b.id, b.headline, b.subtext, b.cta_text, b.cta_url, b.image_url, b.gradient,
            b.campaign_id, c.code AS campaign_code
     FROM banners b LEFT JOIN bonus_campaigns c ON c.id = b.campaign_id
     WHERE b.placement = $1 AND b.active = true LIMIT 1`,
    [placement],
  )
  if (rows.length === 0) return null
  const r = rows[0]
  const ctaUrl = r.campaign_id
    ? (r.campaign_code ? `/rewards?code=${encodeURIComponent(r.campaign_code)}` : '/rewards')
    : r.cta_url
  return {
    id: r.id, headline: r.headline, subtext: r.subtext,
    ctaText: r.cta_text, ctaUrl, imageUrl: r.image_url, gradient: r.gradient,
  }
```

- [ ] **Step 3: Run tests + full suite + tsc** — PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/banners/public.ts apps/api/src/routes/banners/public.test.ts
git commit -m "feat(api): public banner CTA resolves to linked campaign reward

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Rewards page prefills promo code from `?code=`

**Files:** Modify `apps/web/src/app/(player)/rewards/page.tsx`

- [ ] **Step 1: Read the query param and prefill.** The page is a client component with `promoCode` state. Use Next.js `useSearchParams()` to read `code` on mount; if present, `setPromoCode(code.trim().toUpperCase())`. Do NOT auto-submit. Because `useSearchParams()` requires a Suspense boundary in Next 14, either wrap the page body in `<Suspense>` (export a small wrapper that renders the existing component inside Suspense) or read the param in a child component wrapped in Suspense. Keep the existing behavior otherwise; only prefill once on mount (guard so it does not clobber the user's typing on re-render).

- [ ] **Step 2: Typecheck** — `cd apps/web && npx tsc --noEmit` clean. (Confirm no build error from `useSearchParams` needing Suspense.)

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(player)/rewards/page.tsx"
git commit -m "feat(web): prefill Rewards promo code from ?code= query param

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Admin Promotions UI - link dropdown + list display

**Files:** Modify `apps/admin/src/app/dashboard/page.tsx`

- [ ] **Step 1: Types + form.** Read the `Banner` type, `NewBannerForm` type, `defaultForm(placement)`, `handleCreate`, and `fetchBanners` in this file. Add `campaignId?: string | null` and `campaignName?: string | null` to `Banner`; add `campaignId: string` to `NewBannerForm` (''=none) and to `defaultForm` (default '').

- [ ] **Step 2: Campaign options.** In `BannerSection`, fetch `/admin/banners/campaign-options` (via the same admin api client the file uses) into local state when the create form opens (or on mount). Store `[{ id, name, code }]`.

- [ ] **Step 3: Dropdown.** In the create form, add an optional "Link to campaign" `<select>`: first option `value=""` label "None (use CTA URL)", then one option per campaign with label `name` + (code ? ` (${code})` : ''). Bind to `form.campaignId` via the existing `update('campaignId', value)` helper.

- [ ] **Step 4: Submit mapping.** In `handleCreate` (or where the POST body is built), send `campaignId: form.campaignId || null` so ''-> null. Keep the rest of the payload unchanged.

- [ ] **Step 5: List display.** In the banner table, show the linked campaign: add a small "Campaign" cell/badge rendering `b.campaignName` when set (else a muted "none"). Keep existing columns.

- [ ] **Step 6: Typecheck** — `cd apps/admin && npx tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/app/dashboard/page.tsx
git commit -m "feat(admin): link a banner to a campaign in Promotions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Verify + deploy

- [ ] **Step 1:** `cd apps/api && npx vitest run && npx tsc --noEmit` (green).
- [ ] **Step 2:** `cd apps/admin && npx tsc --noEmit` and `cd apps/web && npx tsc --noEmit` (clean).
- [ ] **Step 3:** Merge branch to master; push. Deploy API (`srv-d7eb279o3t8c73ebvvdg`, migration 043), Admin (`srv-d7ee004vikkc73enkl40`), Web (`srv-d7edvs57vvec73ep0shg`). Capture deploy ids, poll to `live`.
- [ ] **Step 4:** Prod smoke: API `/health` 200; `/banners/landing` 200 (returns a banner object); `/admin/banners` 401; `/admin/banners/campaign-options` 401; web `/rewards` loads 200 with and without `?code=TEST`.

---

## Self-Review Notes

- **Spec coverage:** migration (Task 1); admin link field + list join + options endpoint (Task 2); public CTA resolution (Task 3); Rewards `?code=` prefill (Task 4); admin dropdown + list (Task 5); verify+deploy (Task 6). All spec items mapped.
- **Type consistency:** `campaignId` used across admin API (Task 2), admin UI (Task 5), and the FK column; public route uses `campaign_id`/`campaign_code`; `campaignName` returned by the admin list join and consumed by the admin UI.
- **Safety:** additive migration; unlinked banners unchanged; linked CTA override is serve-time only (no data overwrite of `cta_url`); `?code=` prefill never auto-submits; no auto-sync. `encodeURIComponent` on the code guards the URL.
