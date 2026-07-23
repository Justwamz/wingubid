# Bonus follow-ups — design

**Date:** 2026-07-23
**Status:** Approved for planning
**Part of:** the bonus system. Cleanup batch after Slices 1-3c.

## Problem

A set of accumulated non-blocking follow-ups from the bonus slices: correctness
and security hardening, two product gaps, two UX fixes, and two test-coverage
backfills. Scratch-card bonus funding was explicitly deferred (its own slice).

## Items (all locked with the user)

### Correctness / security

1. **deposit-match connection release.** `deposit-match.service.ts` uses a bare
   `client.release()` on the error path; if `ROLLBACK` itself fails, the original
   error is masked and a possibly-poisoned connection returns to the pool. Fix:
   restructure so the client is released in both success and error paths, and on a
   failed `ROLLBACK` the client is released WITH the error (`client.release(err)`)
   so node-pg destroys it instead of reusing it. The never-throws contract is
   preserved.

2. **Rate-limit `/bonuses/claim`.** Only the global (opt-in) limiter exists; the
   claim endpoint has none. Add a per-route `config.rateLimit` (the app already
   registers `@fastify/rate-limit` with `global:false` and a friendly
   `TOO_MANY_REQUESTS` builder). Limit: `max: 5, timeWindow: '1 minute'` per
   client (default key = IP). Claiming is rare; 5/min is generous and blunts
   code-guessing / claim hammering.

3. **Criteria counts + targeting exclude non-active players.** `buildCriteria`
   never restricts player status, so `countMatchingPlayers` (admin preview) and
   the `/bonuses/available` live filter both include suspended / self-excluded
   players. Fix: `buildCriteria` always includes `pl.status = 'active'` as a base
   condition (so an empty criteria yields `pl.status = 'active'`, not `TRUE`).
   This also makes the no-criteria preview count = active players (previously the
   full table). `playerMatchesCriteria` is unaffected in practice (callers already
   verify the player is active first), and gains defense-in-depth.

### Product

4. **Clear code / criteria on campaign edit.** The PUT edit route uses
   `COALESCE`, so a promo code or targeting criteria can be set but never unset.
   Fix: the edit body accepts an explicit `null` for `code` and `criteria` to
   clear them, while an absent field keeps the current value. Distinguish "field
   absent" (keep) from "field present and null" (clear): for these two columns,
   build the `SET` clause dynamically — include `code = $n` (value may be null)
   only when `code` is present in the request body; likewise `criteria`. All other
   columns keep their `COALESCE` behavior. The existing no-code-on-deposit_match
   guard still applies (clearing a code is always allowed).

### UX

5. **Rewards stale success banner.** On the Rewards page, `promoSuccess` and the
   `claimSuccess` map are never reset, so a prior success message lingers (and can
   sit next to a later error). Fix: reset `promoSuccess` to null at the start of
   `handleApplyCode` and when the promo input changes; the per-campaign
   `claimSuccess` is cleared for a campaign when a new claim on it starts. No copy
   change.

6. **Claimable list hides abuse-blocked players.** `/bonuses/available` shows
   campaigns as `claimable` using only the no-active-bonus check; a player whose
   abuse signals would block every self-service claim still sees claimable
   campaigns that then fail. Since blocks are player-level (prior_bonus /
   device_bonus / ip_bonus, plus ip_velocity severity=block — same set the claim
   flow treats as blocking), evaluate eligibility ONCE per request: if the player
   is blocked, return an empty campaign list (hide all). No abuse reason is ever
   returned to the player (PII / anti-gaming). Untargeted + targeted campaigns are
   otherwise unchanged.

7. **Deposit-bonus toast.** A deposit-match bonus lands silently. Add a
   lightweight, dependency-free toast in `(player)/layout.tsx`: it already fetches
   `/player/me` (`wallet.bonus_balance`) and re-fetches on the `balanceRefresh`
   event. Track the previous `bonus_balance` in a ref; when it INCREASES between
   fetches (skipping the initial load), show a transient toast ("Bonus added to
   your account!"). This fires for the deposit-match case (bonus balance rises
   after a deposit) and harmlessly for a self-service claim. Auto-dismiss after a
   few seconds. Styled to match the app (no toast library).

### Tests

8. **CampaignsTab PUT edit route tests.** The `/admin/campaigns/:id` PUT route is
   untested. Add: a partial edit updates only provided fields; a duplicate code on
   edit maps `23505` -> `409 CODE_TAKEN`; clearing code/criteria via explicit null
   works (covers item 4).

9. **Eligibility SQL integration test.** `evaluateBonusEligibility` has thin
   coverage. Add a focused test of its query + flag logic (mock the pool): asserts
   the prior_bonus / device_bonus / ip_bonus / ip_velocity flags fire from their
   respective query results and severities are correct.

## Out of scope

- Scratch-card `fund_source` column (deferred to its own slice).
- Any new backend endpoint for the toast (item 7 is client-only).
- Per-campaign block reasons surfaced to players (never — PII / anti-gaming).

## Testing

- API: full vitest + tsc; new tests for rate-limit (429 after limit), criteria
  status filter, /bonuses/available hide-when-blocked, PUT edit route, eligibility.
- Web: tsc; Rewards banner reset and layout toast are typecheck-gated + manual.
- Existing bonus/claim/deposit tests stay green.

## Rollout

- No migration. Deploy API + Admin + Web. Smoke: /bonuses/claim 401, rapid repeat
  -> 429; /admin/campaigns 401; rewards + dashboard load 200.
