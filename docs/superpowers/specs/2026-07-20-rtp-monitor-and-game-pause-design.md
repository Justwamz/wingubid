# RTP risk monitor + manual game pause - Design

**Date:** 2026-07-20
**Status:** Approved

## Goal

Warn the risk team by email when a game's realized RTP runs too high (house
losing margin), and let admins temporarily pause/resume any game. Warn-only:
the system never auto-disables - a human decides. Monitored games: crash, mines,
dice, scratch.

## RTP measurement

Realized RTP = payouts / stakes over a rolling window (default 60 min), per game:
- `bets` grouped by `game_type` (crash/mines/dice), rows with `status IN
  ('won','lost')`, windowed on `settled_at`; RTP = SUM(COALESCE(winnings,0)) /
  SUM(gross_stake).
- `scratch_cards`, windowed on `created_at`; RTP = SUM(prize_cents) /
  SUM(stake_cents).

**Variance safeguard:** a game is only evaluated once it has >= `minBets`
settled bets in the window (default 200). Lottery is excluded (lumpy draw-based
RTP).

## Monitor (warn-only)

A node-cron job every 5 min computes RTP and, for each monitored game with
enough sample whose RTP exceeds its `warnRtp` threshold, emails the risk address
via the existing email service. Re-alerts are throttled to once per
`reAlertMinutes` (default 60) per game (in-memory last-alert map).

Defaults (`game_settings` key `rtp_monitor`): `{ windowMinutes:60, minBets:200,
reAlertMinutes:60, warnRtp:{ crash:1.02, mines:1.02, dice:1.02, scratch:0.90 } }`
(crash/mines/dice expected ~95% RTP, scratch ~76%).

## Manual pause/resume

New per-game enabled flags in `game_settings` (`crash_enabled` ... default true,
15s cache). `assertGameEnabled(game)` throws `AppError('GAME_DISABLED', 'This
game is temporarily unavailable. Please try again later.', 423)` at each bet
entry point:
- crash `placeBet`, dice `rollDice`, mines `startGame`, scratch `buyScratchCard`,
  lottery `buyTicket`.
Routes already translate AppError; the crash socket already emits `bet:error`
with the code. Reveal/cashout of in-progress mines games remain allowed (only
`startGame` is gated).

## Admin (Game Settings tab)

`GET /admin/game-settings` extended with: `gamesEnabled` (all 5), `realizedRtp`
(current-window snapshot per monitored game with sample size), and `rtpMonitor`
config. New:
- `PUT /admin/game-settings/game-enabled { game, enabled }` - pause/resume.
- `PUT /admin/game-settings/rtp-monitor { windowMinutes?, minBets?, reAlertMinutes?, warnRtp? }`.

UI: an "Availability & RTP" section - per game a Pause/Resume toggle and live
realized RTP (red when above its warn threshold, green otherwise, grey when
sample too small), plus the monitor config (window, min bets, per-game warn %).

## Player UX

`GET /games/config` extended with `enabled` per native game. The lobby
(`games/page.tsx`) greys a paused game's card and disables PLAY NOW. Any bet on a
paused game returns the friendly `GAME_DISABLED` error regardless.

## Data / infra

No new tables (reuse `game_settings` JSONB). Migration 035 adds a partial index
`bets(game_type, settled_at) WHERE status IN ('won','lost')` for the window query
and seeds the enabled flags + `rtp_monitor` defaults. Alerts reuse `sendEmail`.

## Testing

`tsc` (api/admin/web); unit test for the RTP computation shape and the
warn/min-sample decision; deploy; verify the monitor query runs and a manual
pause blocks a bet with GAME_DISABLED (via the QA account), then resume.

## Out of scope

Auto-disable, lottery RTP monitoring, per-country thresholds.
