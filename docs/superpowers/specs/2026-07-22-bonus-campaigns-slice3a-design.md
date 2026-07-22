# Bonus campaigns + self-service welcome claim (Slice 3a) — design

**Date:** 2026-07-22
**Status:** Approved for planning
**Part of:** the bonus system. Slice 3a (of the Slice-3 campaign/claims group). Slices 1 (engine) + 2 (abuse prevention) shipped.

## Problem

Bonuses can only be granted manually by an admin (Slice 1). There is no
admin-configurable campaign and no way for players to claim a bonus themselves.
This slice adds the campaign model + admin CRUD + a self-service claim for an
open/welcome campaign, reusing the Slice-2 abuse engine at claim time. Promo
codes + target lists (3b) and deposit-match (3c) build on this.

## Decisions (locked with the user)

- Decompose Slice 3; build 3a (campaign engine + welcome claim) first.
- Self-service claim enforcement is strict (no admin present): `prior_bonus`,
  `device_bonus`, `ip_bonus` block the claim; `ip_velocity` blocks per config.
- "One per customer" = one bonus EVER per player across manual grants + campaign
  claims (the `prior_bonus` flag already means "any bonus_grants row exists").
- Players claim from a dedicated **Rewards** page.

## Data model — migration `039_bonus_campaigns.sql`

```sql
CREATE TABLE bonus_campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           VARCHAR(40) UNIQUE NOT NULL,
  name          VARCHAR(120) NOT NULL,
  description   VARCHAR(500),
  type          VARCHAR(20) NOT NULL CHECK (type IN ('welcome','custom')),
  reward_kind   VARCHAR(20) NOT NULL DEFAULT 'fixed' CHECK (reward_kind IN ('fixed')),
  amount_cents  BIGINT NOT NULL CHECK (amount_cents > 0),
  expiry_days   INT NOT NULL DEFAULT 30 CHECK (expiry_days BETWEEN 1 AND 365),
  starts_at     TIMESTAMPTZ,     -- null = no lower bound
  ends_at       TIMESTAMPTZ,     -- null = no upper bound
  status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  created_by    UUID REFERENCES admin_users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bonus_claims (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES bonus_campaigns(id),
  player_id   UUID NOT NULL REFERENCES players(id),
  grant_id    UUID REFERENCES bonus_grants(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, player_id)   -- one claim per campaign per player (race-safe)
);
CREATE INDEX idx_bonus_claims_player ON bonus_claims(player_id);

-- Grants learn they came from a campaign.
ALTER TABLE bonus_grants DROP CONSTRAINT IF EXISTS bonus_grants_source_check;
ALTER TABLE bonus_grants ADD CONSTRAINT bonus_grants_source_check
  CHECK (source IN ('manual','campaign'));
ALTER TABLE bonus_grants ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES bonus_campaigns(id);
```

## Wallet + eligibility changes

- `grantBonus` (Slice 1) generalized:
  `grantBonus(client, playerId, amount, grantedBy: string | null, expiresAt, opts?: { source?: 'manual' | 'campaign'; campaignId?: string | null })`.
  Defaults `source='manual'`, `campaignId=null`, so admin grants are unchanged.
  The INSERT writes `source` + `campaign_id`; `granted_by` is null for claims.
- `evaluateBonusEligibility` (Slice 2) broadened: the "this player's signals"
  subqueries change from `kind = 'signup'` to `kind IN ('signup','claim')`, so a
  claim's own IP/device are considered. (Benefits admin grants too.)

## Claim flow (player)

- `GET /bonuses/available` (`authenticate`): active, in-window campaigns the
  player has NOT already claimed. Each row: `{ id, key, name, description,
  amountCents, claimable, reason? }` where `claimable` reflects the cheap checks
  (not already claimed, no active bonus). The full abuse check runs at claim.
- `POST /bonuses/claim` (`authenticate`), body `{ campaignId, deviceId? }`:
  1. Load campaign; must be `status='active'` and within `[starts_at, ends_at]`.
     Else `422 CAMPAIGN_UNAVAILABLE`.
  2. Reject if the player already has an active bonus (`422 ACTIVE_BONUS_EXISTS`).
  3. Capture a `claim` `player_signals` row (validated `req.ip` via `net.isIP`,
     `deviceId`), best-effort but before the eligibility check so this claim's
     IP/device count.
  4. `evaluateBonusEligibility(playerId)`. Strict self-service rule: if any flag
     of type `prior_bonus | device_bonus | ip_bonus` exists, or `ip_velocity`
     with severity `block`, reject `422 NOT_ELIGIBLE` with a friendly message
     that does not reveal which signal matched; log the block (admin_audit_log or
     a server log line with the flags).
  5. Eligible: in one transaction, `grantBonus(..., { source:'campaign',
     campaignId })` then `INSERT INTO bonus_claims (campaign_id, player_id,
     grant_id)`. The UNIQUE(campaign_id, player_id) makes a double-claim race
     fail with `23505` -> return `422 ALREADY_CLAIMED`.
  6. Return `{ ok: true, amountCents }`.

## Admin — campaigns

- New RBAC permissions `campaigns.view`, `campaigns.manage` (code catalog).
- Routes (`apps/api/src/routes/admin/campaigns.ts`, registered in server):
  - `GET /admin/campaigns` (`campaigns.view`) — list with claim counts.
  - `POST /admin/campaigns` (`campaigns.manage`) — create `{ key, name,
    description?, type, amountCents, expiryDays?, startsAt?, endsAt? }`.
  - `PUT /admin/campaigns/:id` (`campaigns.manage`) — edit fields.
  - `PUT /admin/campaigns/:id/status` (`campaigns.manage`) — active/paused/ended.
  - All mutations audited (entity `'campaign'`).
- Admin UI: a new **Campaigns** tab (permission-gated via `TAB_PERMISSION`,
  `campaigns.view`): list + create/edit form (name, type, amount KES, expiry
  days, active window, status).

## Player UI

- A **Rewards** page under `apps/web/src/app/(player)/rewards/page.tsx`, linked
  in the player nav: fetches `/bonuses/available`, lists claimable campaigns with
  a Claim button, and on claim shows success (amount credited to the bonus
  wallet) or the friendly not-eligible / already-claimed message. Refreshes the
  bonus balance (the existing `balanceRefresh` event) on success.

## Config

- A campaign sets its own `expiry_days` (per-grant expiry). The per-bet **win
  cap stays global** (`bonus_max_win_cents`) for campaign grants in 3a - settlement
  is unchanged from Slice 1. A per-campaign win-cap override is a deliberate
  later enhancement (would require threading a per-grant cap into every game's
  settle path); it is out of scope here to keep the blast radius small.

## Testing

- `grantBonus`: campaign source path writes `source='campaign'` + `campaign_id`,
  null grantedBy; manual path unchanged.
- Eligibility engine: claim signals now count (a claim-time device/IP match
  flags), signup still works.
- Claim route: happy path grants + records a claim; already-claimed -> 422; active
  bonus -> 422; campaign paused/out-of-window -> 422; a block flag -> 422
  NOT_ELIGIBLE and no grant/claim written.
- Admin campaign routes: create/list/edit/status happy paths + permission gates.
- Existing bonus/grant tests stay green (grantBonus defaults preserve behavior).

## Rollout

- Migration on API boot. Deploy API, then Admin, then Web.
- Verify: API tsc + full vitest; admin/web tsc; prod smoke of `/admin/campaigns`
  (401) and `/bonuses/available` (401).

## Out of scope (3b / 3c)

- Promo codes (claim-by-code), target lists (restrict who can claim),
  deposit-match auto-grant, per-flag configurable claim enforcement, and
  deposit/login signal capture beyond the claim signal.
