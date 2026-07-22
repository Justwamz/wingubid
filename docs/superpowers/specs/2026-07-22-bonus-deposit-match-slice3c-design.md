# Bonus deposit-match (Slice 3c) — design

**Date:** 2026-07-22
**Status:** Approved for planning
**Part of:** the bonus system. Slice 3c — the final campaign type (builds on 3a campaigns + 3b targeting).

## Problem

Campaigns support fixed self-service claims (3a) with promo codes + criteria (3b).
The last type is a **deposit match**: automatically grant a bonus proportional to
a qualifying deposit. It must fire off the real deposit flow, never fail a
deposit, and reuse the existing grant/claim/targeting machinery.

## Decisions (locked with the user)

- Trigger: the **first qualifying deposit** (deposit >= campaign min, campaign
  active) grants the match; one-claim-per-campaign means once per player.
- Eligibility (lighter, since a real deposit raises the bar): account **active**,
  **no active bonus**, **not already matched by this campaign**, and matches the
  campaign **criteria** if set. NO device/IP/prior-bonus abuse blocks.
- If several deposit-match campaigns are active, apply **one best match** (newest
  active, in-window, qualifying).
- Best-effort: a match failure NEVER rolls back or fails the deposit.

## Data model — migration `041_deposit_match.sql`

```sql
ALTER TABLE bonus_campaigns
  ADD COLUMN IF NOT EXISTS match_percent     INT,
  ADD COLUMN IF NOT EXISTS max_match_cents   BIGINT,
  ADD COLUMN IF NOT EXISTS min_deposit_cents BIGINT;

-- Widen type + reward_kind to allow deposit_match.
ALTER TABLE bonus_campaigns DROP CONSTRAINT IF EXISTS bonus_campaigns_type_check;
ALTER TABLE bonus_campaigns ADD CONSTRAINT bonus_campaigns_type_check
  CHECK (type IN ('welcome','custom','deposit_match'));
ALTER TABLE bonus_campaigns DROP CONSTRAINT IF EXISTS bonus_campaigns_reward_kind_check;
ALTER TABLE bonus_campaigns ADD CONSTRAINT bonus_campaigns_reward_kind_check
  CHECK (reward_kind IN ('fixed','deposit_match'));

-- amount_cents applies only to fixed; deposit_match uses the match_* fields.
ALTER TABLE bonus_campaigns ALTER COLUMN amount_cents DROP NOT NULL;
ALTER TABLE bonus_campaigns DROP CONSTRAINT IF EXISTS bonus_campaigns_amount_cents_check;
ALTER TABLE bonus_campaigns ADD CONSTRAINT bonus_campaigns_reward_shape_check CHECK (
  (reward_kind = 'fixed' AND amount_cents IS NOT NULL AND amount_cents > 0)
  OR
  (reward_kind = 'deposit_match' AND match_percent > 0 AND max_match_cents > 0 AND min_deposit_cents >= 0)
);
```

> The exact auto-name of the existing `amount_cents > 0` column CHECK is
> `bonus_campaigns_amount_cents_check`; `DROP ... IF EXISTS` is safe if it differs.

## Auto-grant engine — `apps/api/src/services/deposit-match.service.ts`

`maybeGrantDepositMatch(playerId: string, depositAmountCents: number): Promise<void>`
— self-contained, wrapped so it NEVER throws to the caller:

1. Load the player's status; if not `active`, return.
2. If the player has an active bonus grant, return (they finish the current one
   first).
3. Select candidate campaigns: `reward_kind = 'deposit_match'`, `status =
   'active'`, in window, `min_deposit_cents <= depositAmountCents`, not already in
   `bonus_claims` for this player, ordered by `created_at DESC`.
4. For each candidate (newest first), if it has `criteria` and
   `playerMatchesCriteria` is false, skip; else this is the match. If none, return.
5. `bonus = min(floor(depositAmountCents * match_percent / 100), max_match_cents)`.
   If `bonus <= 0`, return.
6. In one transaction: `grantBonus(client, playerId, bonus, null, expiresAt,
   { source: 'campaign', campaignId })` (expiry from the campaign's `expiry_days`)
   + `INSERT INTO bonus_claims (campaign_id, player_id, grant_id)`. On `23505`
   (already matched, race) roll back and return quietly.

The whole function body is wrapped in try/catch that logs and swallows, so a
malformed campaign or a race can never surface to the deposit path.

## Deposit hooks

Call `maybeGrantDepositMatch(playerId, amount)` AFTER the deposit transaction has
committed (and only when a deposit was actually credited), at the three sites:
- `payment.service.confirmDeposit` — after the success-path COMMIT (guard on the
  `success` credit having happened).
- `c2b.service.recordC2bPayment` — after the credit COMMIT (only when a player was
  matched + credited, not on the unmapped/refund paths).
- `c2b.service.repostC2bPayment` — after the repost COMMIT.

Each call is post-commit on the pool (not the deposit's client) and, since the
service never throws, needs no extra guarding; still, callers should not `await`
it inside their transaction.

## Claim/list guard

Deposit-match campaigns are auto-only:
- `GET /bonuses/available` excludes `reward_kind = 'deposit_match'` (already
  excludes code campaigns).
- `claimCampaignBonus` rejects a `deposit_match` campaign with
  `CAMPAIGN_UNAVAILABLE` (it is granted automatically, not claimed).

## Admin — `apps/api/src/routes/admin/campaigns.ts`

- Create/edit accept `rewardKind: 'fixed' | 'deposit_match'` (default 'fixed') and,
  for deposit_match, `matchPercent`, `maxMatchCents`, `minDepositCents`. Zod
  refine: fixed requires `amountCents`; deposit_match requires the three match
  fields (`matchPercent` 1-100, `maxMatchCents` > 0, `minDepositCents` >= 0) and
  ignores `amountCents`. Persist the new columns; list returns them.
- The DB `reward_shape_check` is the backstop; a violation surfaces as a clean 400.

## Admin UI — `CampaignsTab.tsx`

- A **Reward kind** select (Fixed amount / Deposit match). Fixed shows the amount
  field (as today); Deposit match shows Match % , Max match (KES), Min deposit
  (KES). Build the right payload per kind. The table shows a reward summary
  ("KES 500 fixed" or "50% up to KES 500, min KES 100").

## Player

No new claim UI. After a qualifying deposit the bonus balance rises on the next
balance refresh; the existing `bonus_granted` ledger row records it. A "you got a
deposit bonus" toast is a possible later touch (out of scope).

## Testing

- `deposit-match.service`: qualifying deposit grants `min(floor(dep*pct/100),
  cap)` + records a claim; below-min -> no grant; player with active bonus -> no
  grant; already-matched -> no grant; non-active player -> no grant; criteria
  mismatch -> no grant; picks the newest qualifying when several; NEVER throws
  even if a query errors (mock a rejection -> resolves).
- Deposit hooks: a successful deposit calls `maybeGrantDepositMatch` with the
  player + amount (mock the service); a failed/declined deposit does not.
- Admin routes: create a deposit_match campaign (match fields) returns id;
  missing match fields -> 400; create fixed still works.
- Claim/list: `claimCampaignBonus` on a deposit_match campaign -> CAMPAIGN_UNAVAILABLE;
  `/bonuses/available` omits deposit_match campaigns.
- Existing deposit + campaign + claim tests stay green.

## Rollout

- Migration on API boot. Deploy API, then Admin (Web needs no change, but redeploy
  is harmless/optional).
- Verify: API tsc + full vitest; admin tsc; prod smoke of a deposit-match campaign
  create (admin) + a test deposit granting the match.

## Out of scope

- Reload / every-deposit matches; unique per-player codes; per-campaign win-cap
  override; matches on external/provider deposit paths beyond the three in-house
  credit sites; a player-facing deposit-bonus toast.
