# Data-driven game ordering - Design

**Date:** 2026-07-20
**Status:** Approved

## Goal

Reorder games by a house-optimized metric (revenue + activity) so higher-earning,
active games surface first - on the landing page (within existing categories) and
the games page. No labels or badges; purely the order changes. No deceptive
"popular" claim.

## Metric

Per native game (crash/mines/dice/scratch/lottery), over a rolling 7-day window:
- `houseRevenue = SUM(stakes) - SUM(payouts)`; `activity = SUM(stakes)`.
- Sources: `bets` (crash/mines/dice, status in won/lost, windowed on settled_at);
  `scratch_cards` (created_at); `lottery_tickets` (status in won/lost, created_at).
- Min-max normalize revenue and activity across games, then
  `score = 0.7 * revenueNorm + 0.3 * activityNorm`. Rank highest first.
- Only games with >= a minimum stake volume (default KES 1,000 = 100000 cents) in
  the window are ranked; games below that keep the current hand-set order and sit
  after ranked ones, so thin data never scrambles the lobby.

Weights/window/threshold live in code (can be surfaced in admin later).

## Delivery

`GET /games/config` gains `order: string[]` (ranked game keys). Computed
server-side in `game-order.service` with a ~5 min in-memory cache (refreshes
gradually; cheap aggregate query, aided by the existing
`bets(game_type, settled_at)` index). No new tables/migration.

`rankGames(stats)` is a pure function (unit-tested); `getGameOrder()` wraps it
with the DB fetch + cache.

## Client

A stable `applyOrder(list, order)` helper: games whose key is in `order` come
first (by rank); everything else (games below threshold, provider "coming soon"
tiles) keeps its original relative order.

- **Landing** (`page.tsx`): apply within `CRASH_GAMES` and `CASINO_GAMES` after the
  availability mapping. Categories themselves don't move; provider tiles keep
  their spots after the ranked Wingu games. Map entry -> key via its
  `/games/wingu-*` href (wingu-lotto -> lottery).
- **Games page** (`games/page.tsx`): apply to the `GAMES` array (reusing the
  existing href->key map). Provider "coming soon" list untouched.

## Testing

`tsc` (api/web); unit tests for `rankGames` (blend ordering, min-volume fallback,
negative-revenue handling); deploy; confirm `/games/config` returns a sane
`order` and both pages reflect it.

## Out of scope

Admin UI to tune weights/window, per-category metrics, randomization.
