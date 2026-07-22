# Bonus promo codes + criteria targeting (Slice 3b) — design

**Date:** 2026-07-22
**Status:** Approved for planning
**Part of:** the bonus system. Slice 3b (builds on 3a campaigns/claims). 3c = deposit match.

## Problem

Campaigns (3a) are open to everyone. Marketing needs two optional filters: a
**promo code** to gate a campaign behind a code, and **audience targeting** by
live criteria (e.g. new signups, non-depositors, dormant players). Both are
optional, combinable attributes on the existing campaign; the claim flow enforces
them on top of the 3a checks.

## Decisions (locked with the user)

- Promo code = one shared code per campaign (not per-player).
- Targeting = live/dynamic criteria (no snapshot list); a player must match at
  claim time and to see a targeted campaign in their Rewards list.
- Criteria fields: registered-within-N-days, deposit status (has/none + optional
  min total), betting activity (has/none). (No country/other in 3b.)
- Code + targeting are optional, combinable attributes on `bonus_campaigns`.
- Rewards list evaluates criteria live per active campaign for the viewing player.

## Data model — migration `040_campaign_targeting.sql`

```sql
ALTER TABLE bonus_campaigns
  ADD COLUMN IF NOT EXISTS code     VARCHAR(40),
  ADD COLUMN IF NOT EXISTS criteria JSONB;
-- Shared code is unique when set (stored normalized uppercase).
CREATE UNIQUE INDEX IF NOT EXISTS uq_bonus_campaigns_code
  ON bonus_campaigns(code) WHERE code IS NOT NULL;
```

`criteria` JSON shape (all fields optional; null/absent = no constraint):
```
{ registeredWithinDays?: number,       // players.created_at >= now() - N days
  depositStatus?: 'has' | 'none',      // completed deposit exists / not
  minTotalDepositCents?: number,       // SUM(completed deposits) >= X
  bettingActivity?: 'has' | 'none' }   // any bet exists / not
```
`criteria = null` means untargeted (open). `code = null` means no code.

## Criteria engine — `apps/api/src/services/bonus-criteria.service.ts`

A single builder produces a parameterized SQL WHERE fragment over the `players`
table (aliased `pl`), reused for both the per-player check and the count:

- `buildCriteria(criteria): { where: string; params: unknown[] }`
  - `registeredWithinDays` -> `pl.created_at >= NOW() - make_interval(days => $n)`
  - `depositStatus 'has'` -> `EXISTS (SELECT 1 FROM transactions t WHERE t.player_id = pl.id AND t.type='deposit' AND t.status='completed')`; `'none'` -> `NOT EXISTS (...)`
  - `minTotalDepositCents` -> `(SELECT COALESCE(SUM(amount),0) FROM transactions t WHERE t.player_id=pl.id AND t.type='deposit' AND t.status='completed') >= $n`
  - `bettingActivity 'has'` -> `EXISTS (SELECT 1 FROM bets b WHERE b.player_id = pl.id)`; `'none'` -> `NOT EXISTS (...)`
  - no conditions -> `where = 'TRUE'`
- `playerMatchesCriteria(playerId, criteria): Promise<boolean>` — `SELECT EXISTS
  (SELECT 1 FROM players pl WHERE (<where>) AND pl.id = $k)`; a `null`/empty
  criteria returns true.
- `countMatchingPlayers(criteria): Promise<number>` — `SELECT COUNT(*) FROM
  players pl WHERE (<where>)`.
- A Zod schema `criteriaSchema` validates the shape on write (positive ints,
  enums), used by the admin routes.

## Claim flow (extends 3a) — `bonus-claim.service.ts`

`claimCampaignBonus(playerId, campaignId, ip, deviceId, code?)`. The campaign
load also selects `code`, `criteria`. New checks run first, in order:
1. Campaign active + in window (unchanged).
2. If `campaign.code` is set: `code` must be provided and equal (case-insensitive,
   trimmed) else `422 INVALID_CODE` ("That promo code is not valid.").
3. If `campaign.criteria` is set: `playerMatchesCriteria(playerId, criteria)` must
   be true else `422 NOT_ELIGIBLE` (generic; no criteria detail).
4. Then unchanged: not-already-claimed -> no-active-bonus -> best-effort claim
   signal -> strict abuse -> atomic grant + claim.

Code resolution: a `resolveCampaignByCode(code): Promise<campaignId | null>`
(case-insensitive) so the endpoint can accept a code without a campaignId.

## Player routes — `apps/api/src/routes/bonuses.ts`

- `POST /bonuses/claim` body becomes `{ campaignId?, code?, deviceId? }` with a
  refine requiring `campaignId` OR `code`. If `code` given (no campaignId),
  resolve to a campaign (404/INVALID_CODE if none), then claim it passing the
  code. If `campaignId` given, claim it (the service still enforces the campaign's
  code if it has one).
- `GET /bonuses/available` changes:
  - Exclude code-gated campaigns (`code IS NOT NULL`) — hidden until a code is
    entered.
  - Fetch active, in-window, unclaimed, non-code campaigns; then in the handler,
    for each with `criteria`, call `playerMatchesCriteria` and drop non-matching
    (a handful of campaigns; live + accurate). Untargeted campaigns always show.

## Admin — `apps/api/src/routes/admin/campaigns.ts`

- Create/edit bodies gain optional `code` (trimmed; stored uppercase) and
  `criteria` (validated by `criteriaSchema`). Duplicate code -> `409 CODE_TAKEN`
  (from the unique index). List returns `code` + `criteria`.
- New `POST /admin/campaigns/preview-count` (`campaigns.view`), body `{ criteria }`
  -> `{ count }` via `countMatchingPlayers`, for the admin live preview.

## Admin UI — `CampaignsTab.tsx`

- Create/edit form gains a **Promo code** input (optional) and a **Targeting**
  section: registered-within-days (number), deposit status (any/has/none + optional
  min deposit KES), betting activity (any/has/none). A debounced call to
  `preview-count` shows "Matches N players" as criteria change.
- The table shows a code badge + a short criteria summary per campaign.

## Player UI — Rewards page

- A "Have a promo code?" input + Apply button that POSTs `/bonuses/claim` with
  `{ code, deviceId }`; success/'not valid' messages surfaced. Listed
  (open/targeted-matching) campaigns claim as in 3a.

## Testing

- `bonus-criteria.service`: buildCriteria produces correct fragments/params;
  `playerMatchesCriteria` true for empty criteria, and matches/rejects per each
  field (mock pool); `countMatchingPlayers` returns the count.
- Claim: wrong/missing code on a code campaign -> 422 INVALID_CODE; correct code
  -> proceeds; criteria mismatch -> 422 NOT_ELIGIBLE; claim-by-code resolves the
  campaign; open campaign unaffected. Existing 3a claim tests stay green (no code,
  no criteria).
- `/bonuses/available`: code campaigns excluded; targeted campaign shown only when
  matching.
- Admin: create with code (dup -> 409 CODE_TAKEN); create with criteria;
  preview-count returns a number; permission gates.

## Rollout

- Migration on API boot (additive columns). Deploy API, then Admin, then Web.
- Verify: API tsc + full vitest; admin/web tsc; prod smoke of
  `/admin/campaigns/preview-count` (401) and `/bonuses/claim` (401).

## Out of scope (3c / later)

- Deposit-match auto-grant (3c); unique per-player codes; country/KYC/other
  criteria; CSV upload; snapshot/materialized segments; code usage limits beyond
  the existing one-claim-per-campaign.
