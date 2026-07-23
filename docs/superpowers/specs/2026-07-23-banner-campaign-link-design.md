# Banner-campaign light link — design

**Date:** 2026-07-23
**Status:** Approved for planning
**Part of:** promotions + bonus systems. The "light link" option: connect a banner to a bonus campaign so its CTA routes to the reward, managed in one place.

## Problem

Banners (Promotions tab) and bonus campaigns (Campaigns tab) are fully separate:
no shared identity, and a banner's `cta_url` is free text. To promote a campaign
today you create the campaign, then separately create a banner and hand-type a URL,
keeping them consistent by hand. The user chose the "light link": an optional link
from a banner to a campaign that drives the banner's CTA destination.

## Decisions (locked)

- A banner may optionally link to ONE bonus campaign via a nullable
  `campaign_id` FK. Linking is optional; unlinked banners behave exactly as today.
- When a banner IS linked, its public CTA DESTINATION is derived from the campaign
  at serve time: `/rewards?code=<CODE>` if the campaign has a promo code, else
  `/rewards`. The banner's `cta_text` (button label) stays admin-controlled. The
  linked destination overrides the manual `cta_url` (the point of "one place").
- The Rewards page reads a `?code=` query param and PREFILLS the promo-code input
  (does NOT auto-submit - the player still taps Apply, avoiding surprise claims).
- No auto-sync in this slice: linking does not auto-activate/deactivate the banner
  when the campaign's status/window changes (that was the heavier "auto-sync" level,
  not chosen). Linking only drives the CTA.
- The link is set at banner CREATE (the Promotions UI has no edit form, only
  create/activate/delete); the API also accepts it on update for completeness and
  allows clearing it (explicit null).

## Data model — migration `043_banner_campaign_link.sql`

```sql
ALTER TABLE banners
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES bonus_campaigns(id);
```

## Admin API — `apps/api/src/routes/admin/banners.ts`

- `bannerBody` (create) + `updateBody`: add `campaignId: z.string().uuid().nullish()`.
- CREATE INSERT: include `campaign_id` (value or null).
- UPDATE: allow setting or clearing `campaign_id`. Since the current UPDATE uses
  COALESCE (cannot clear), handle `campaign_id` with the present-in-raw-body pattern
  (`'campaignId' in body` -> `campaign_id = $n` which may be null); keep COALESCE for
  the other columns.
- GET `/admin/banners` list: LEFT JOIN `bonus_campaigns` and return `campaignId` and
  `campaignName` (null when unlinked) so the UI can show the link.
- New GET `/admin/banners/campaign-options` (auth: `authenticateAdmin`, matching the
  other banner routes): returns active campaigns `[{ id, name, code }]` for the
  dropdown, ordered by created_at DESC.

## Public API — `apps/api/src/routes/banners/public.ts`

- `getActiveBanner(placement)`: LEFT JOIN `bonus_campaigns` on `banners.campaign_id`.
  Compute the effective CTA URL:
  - if a campaign is linked: `campaign.code ? '/rewards?code=' + code : '/rewards'`
  - else: the banner's own `cta_url`.
  Return that as `ctaUrl`. `ctaText`, headline, subtext, image, gradient unchanged.
  (No filtering by campaign status - out of scope; the admin controls banner active
  state manually.)

## Web — Rewards page `apps/web/src/app/(player)/rewards/page.tsx`

- Read the `code` search param on mount (Next.js `useSearchParams`); if present,
  prefill `promoCode` state (uppercased/trimmed to match). Do not auto-submit. This
  makes a linked coded-campaign banner land the player on Rewards with the code
  ready to Apply. (Wrap in a Suspense boundary if Next requires it for
  `useSearchParams` in this app's setup.)

## Admin UI — Promotions tab `apps/admin/src/app/dashboard/page.tsx`

- The `BannerSection` create form gains an optional "Link to campaign" `<select>`
  (None + one option per active campaign, label = name plus code if present). Its
  value flows into `NewBannerForm.campaignId` and is POSTed with the banner.
- Fetch campaign options (from `/admin/banners/campaign-options`) when the section
  mounts / form opens.
- The banner list shows the linked campaign name (a small badge/column) when set.
- `NewBannerForm` type + `defaultForm` gain `campaignId: string` (''=none, mapped to
  null on submit); the `Banner` type gains `campaignId`/`campaignName`.

## Testing

- Migration applies (additive).
- Admin banners: create with `campaignId` persists it; create without is null;
  update can set and clear it; `/admin/banners/campaign-options` returns active
  campaigns; list returns campaignName via the join.
- Public banner: a linked banner with a coded campaign returns
  `ctaUrl='/rewards?code=CODE'`; a linked no-code campaign returns `/rewards`; an
  unlinked banner returns its own `cta_url`.
- Web: tsc; rewards page prefills promo input from `?code=`.
- Existing banner + rewards tests stay green.

## Rollout

- Migration on API boot. Deploy API + Admin + Web. Smoke: `/banners/landing` 200
  (public) and returns a banner; `/admin/banners` 401; rewards page loads with and
  without `?code=`.

## Out of scope

- Auto-activate/deactivate a banner from campaign status/window (auto-sync level).
- A unified "create campaign + banner in one form" flow.
- Linking a banner to multiple campaigns; per-placement campaign rules.
- Enforcing `promotions.*` permissions on banner routes (pre-existing; they use
  `authenticateAdmin` only - not changed here).
