# Lotto pick-6 redesign — design

**Date:** 2026-07-23
**Status:** Approved for planning

## Problem

Wingu Lotto is currently pick-3-of-36 (draw 3, prize tiers for 0-3 matches). The
user wants it changed to pick-6: players choose 6 numbers, 6 are drawn, and prizes
pay for matching 3, 4, 5, or 6. This changes the odds by orders of magnitude, so
the prize table and jackpot are redesigned to a chosen RTP.

## Decisions (locked with the user)

- **Pool:** pick **6 distinct numbers from 1..36**; draw 6. Jackpot (6/6) odds
  1 in C(36,6) = 1,947,792.
- **Paying tiers:** only **3, 4, 5, 6** matches pay (matching 0-2 is common at
  pick-6 and pays nothing). The old "match 1 = break even" tier is removed.
- **Prize multipliers (x stake), SAME for hourly/daily/weekly:**
  `{ 6: 200000, 5: 800, 4: 40, 3: 3 }` (0/1/2 -> 0).
- **RTP ~43.6%** (house edge ~56.4%), identical across all three draw tiers; the
  jackpot CASH differs only by ticket price (KES20 -> 4,000,000; KES100 ->
  20,000,000; KES500 -> 100,000,000).
- No DB migration: numbers are stored as `INT[]` (`picked_numbers`,
  `winning_numbers`); pool/pick/prizes are code constants.

### Odds + RTP (6 of 36, draw 6)

- P(3) = C(6,3)C(30,3)/C(36,6) = 81,200/1,947,792 = 0.0416877
- P(4) = C(6,4)C(30,2)/C(36,6) = 6,525/1,947,792 = 0.0033500
- P(5) = C(6,5)C(30,1)/C(36,6) = 180/1,947,792 = 0.00009241
- P(6) = 1/1,947,792 = 0.000000513
- RTP = 3(0.0416877)+40(0.0033500)+800(0.00009241)+200000(0.000000513)
      = 0.12506 + 0.13400 + 0.07393 + 0.10268 = **0.43567**

## Changes — `apps/api/src/services/lottery.service.ts`

- `LOTTERY_PICK = 6` (was 3). `LOTTERY_POOL = 36` unchanged.
- `PRIZE_MULTIPLIERS`: for each of hourly/daily/weekly, `{ 6: 200000, 5: 800, 4: 40, 3: 3 }`.
  (`calculateLotteryPrize` already returns 0 for absent tiers via `?? 0`.)
- Replace `draw3Numbers()` / `draw3NumbersFromSeed()` with functions that draw
  `LOTTERY_PICK` (6) distinct numbers from the 36 pool. Keep the exact modulo-bias
  rejection and the provable-fair HMAC(serverSeed, `draw-<counter>`) derivation;
  only the count changes. Rename to `drawNumbers()` / `drawNumbersFromSeed()` (or
  `draw6Numbers*`) and update the call site in `lottery-loop.ts`. The seed digest
  loop already advances `counter` until enough numbers are collected, so 6 works.
- `buyTicket`: validate exactly 6 numbers, all distinct, each 1..36. Update the
  three error messages to say 6.
- `getUpcomingDraws`: jackpot = `ticketPrice * PRIZE_MULTIPLIERS[type][6]` (was [3]).
- `countMatches`, `settleTickets`, `getPlayerTickets` unchanged (array-length agnostic).

## Route — `apps/api/src/routes/games/lottery.ts`

- `buyBody.pickedNumbers`: `.length(6, 'Please pick exactly 6 numbers.')`; keep
  min 1 / max 36 element bounds. No other change.

## Draw loop — `apps/api/src/game/lottery-loop.ts`

- Update the import + call from `draw3NumbersFromSeed` to the renamed 6-number
  function. No other logic change (it stores `winning_numbers` then settles).

## Web — `apps/web/src/app/(player)/games/wingu-lotto/page.tsx`

- `NumberPicker`: `atMax = selected.length >= 6`; grid stays 1..36.
- Pick handler: cap at 6 (`prev.length >= 6`).
- Copy: "Choose exactly 6 numbers from 1 to 36..."; rules/how-to-play text: "Match
  3 or more numbers to win; match all 6 for the jackpot." Remove "match 1 to break
  even / match 2 for a bonus" wording.
- Buy button enabled only when 6 selected; selected-count display uses 6.
- Jackpot / prize display: use the [6] multiplier. If the page shows a prize-tier
  breakdown, list 3/4/5/6 with the new multipliers.

## Testing

- `lottery.service`: `drawNumbers`/`drawNumbersFromSeed` return 6 distinct sorted
  numbers in 1..36; determinism from a fixed seed; `PRIZE_MULTIPLIERS` values;
  `calculateLotteryPrize` for 3/4/5/6 and 0 for <3; `buyTicket` rejects != 6, dups,
  out-of-range; `getUpcomingDraws` jackpot uses [6]. Update existing pick-3 tests to
  pick-6.
- `lottery.ts` route: buying with 6 valid numbers succeeds; 3 or 7 -> 400; dup/oob -> 400.
- Existing lottery tests updated from 3 to 6.

## Transitional note (accepted)

Pending tickets bought under pick-3 before deploy will settle against the next
6-number draw via `countMatches` (3 picks vs 6 drawn). They simply match fewer and
mostly win nothing; a rare 3-match pays the new 3x. This straddle is acceptable for
this low-volume game; no data migration or draw freeze is performed.

## Rollout

- No migration. Deploy API (service + loop + route) then Web. Smoke: `/games/lottery/draws`
  returns draws with the new jackpot; buying 6 numbers works; picking 3 -> 400.

## Out of scope

- Parimutuel/pooled jackpots, rollovers, bonus-ball, per-tier RTP scaling, pool
  size change to 49 (considered, not chosen), bonus-fund tickets.
