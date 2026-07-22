# Bonus win display (gross vs net) — design

**Date:** 2026-07-22
**Status:** Approved for implementation
**Follow-up to:** the bonus engine (slice 1).

## Problem

Every in-house game's win response returns the **gross** `winnings` (stake ×
multiplier). For a cash bet the player receives exactly that, so it is correct.
For a **bonus** bet, only the **net** (`min(gross − stake, bonus_max_win)`) is
credited to cash - the free bonus stake is not returned. So a bonus win of
"2.00× on KES 10,000" displays "won KES 20,000" while cash only rises KES 10,000.
Accounting is correct; the display misleads.

## Decision

For a bonus win, show the **net amount actually credited to cash** as the headline
KES figure, keep the multiplier for feel, add a small "(bonus stake deducted)"
note, and add a "max bonus win" note when the 10k cap clipped the amount. Cash
wins are unchanged. The credited amount and cap flag come from the **server**
(respecting the configurable cap), never computed client-side.

## API changes

- `settleBonusWin` returns `{ net, capped }` where
  `capped = (payout - stake) > maxWinCents`.
- Each game's win path computes, for the result it returns:
  - `netCredited`: amount added to cash - `winnings` for a cash win, `net` for a
    bonus win, `0` for a loss.
  - `fundSource`: `'cash' | 'bonus'` (already threaded in).
  - `capped`: `true` only for a bonus win clipped by the cap, else `false`.
- Return-shape additions (existing fields kept):
  - `dice.rollDice` -> add `netCredited, fundSource, capped`.
  - `mines.cashoutMines` -> add `netCredited, fundSource, capped`.
  - `crash.cashout` -> add `netCredited, fundSource, capped`; the crash socket
    `cashout:confirmed` payload carries them.
  - `scratch.buyScratchCard` -> add `netCredited, fundSource, capped` (bonus win
    on a prize).

## UI changes

A small shared helper renders the bonus win note so the four games stay
consistent. For `fundSource === 'bonus'` wins:
- Headline KES = `netCredited` (not gross).
- Keep the multiplier where the game shows one (crash, dice, mines).
- Sub-note: "bonus stake deducted" and, when `capped`, "max bonus win (KES 10,000)".
Cash wins render exactly as today.

Games/files: `wingu-crash/page.tsx` (+ `useCrashGame`, `BetPanel` cashout banner),
`wingu-dice/page.tsx`, `wingu-mines/page.tsx`, `wingu-scratch/page.tsx`.

## Testing

- `settleBonusWin` returns `capped=true` when `payout-stake` exceeds the cap,
  `false` otherwise (extend existing wallet tests).
- Each game's bonus-win test asserts the response includes `netCredited` (= net,
  not gross), `fundSource: 'bonus'`, and correct `capped`.
- Cash-win responses keep `netCredited === winnings`, `capped === false`.
- Web: tsc + existing component tests; the crash settle-counter test stays green.

## Out of scope

Bet-history rows already store gross `winnings`; the combined "My Bets" and
per-game history keep showing gross with the multiplier (a separate, lower-value
tweak). This change targets the live win moment, which is where the mismatch is
most misleading.
