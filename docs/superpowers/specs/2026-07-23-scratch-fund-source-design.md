# Scratch-card fund source persistence (+ toast logout reset) — design

**Date:** 2026-07-23
**Status:** Approved for planning
**Part of:** the bonus system. Brings scratch cards to funding-record parity with crash/dice/mines.

## Problem

Scratch cards can ALREADY be bought with bonus funds end to end: the web page has
the BonusToggle + net-win display, the route accepts `fundSource`, and
`buyScratchCard` debits the bonus wallet (`debitBonusForBet`) and settles the win
net-to-cash with the global cap (`settleBonusWin`). BUT the `scratch_cards` table
(from migration 014, predating the bonus engine) stores neither the funding source
nor the actual net credited. Consequences:

1. No persisted record of whether a card was cash- or bonus-funded, or which grant.
2. History overstates bonus wins: `/games/history/all` and `/games/scratch/history`
   report `prize_cents` (GROSS) as the payout, but a bonus card only credits the
   NET (`min(prize - stake, cap)`) to cash. Crash/dice already show net; scratch does
   not. This is a correctness bug in the "My Bets" and scratch history views.

Also bundle a trivial deferred fix: the deposit-bonus toast's `prevBonusRef` is not
reset when the player logs out.

## Decisions (locked)

- Store the actual net credited on the card (`net_credited_cents`), mirroring how
  `bets.winnings` stores net for bonus bets. The cap (`getBonusMaxWinCents`) is a
  time-varying setting, so computing net later would be wrong; persist it at settle.
- History payout for a scratch card = net credited (falls back to gross for legacy
  rows where the column is null). Bonus cards therefore show the true credited amount.
- No backfill of legacy rows: existing scratch_cards default to `fund_source='cash'`
  and `net_credited_cents = NULL`, so history keeps its current behavior for them
  (gross == net for cash). Any historical bonus-funded card (rare, pre-record) stays
  as-is; this is not a regression, just an unimproved legacy edge. Documented, accepted.

## Data model — migration `042_scratch_fund_source.sql`

```sql
ALTER TABLE scratch_cards
  ADD COLUMN IF NOT EXISTS fund_source        VARCHAR(10) NOT NULL DEFAULT 'cash'
    CHECK (fund_source IN ('cash','bonus')),
  ADD COLUMN IF NOT EXISTS bonus_grant_id     UUID REFERENCES bonus_grants(id),
  ADD COLUMN IF NOT EXISTS net_credited_cents BIGINT;
```

## Service — `apps/api/src/services/scratch.service.ts`

- `buyScratchCard`: the INSERT records `fund_source` and (when bonus) `bonus_grant_id`.
  After the win is settled, set `net_credited_cents` to the actually credited amount
  (cash: `prizeCents`; bonus: the net returned by `settleBonusWin`; 0 when no prize).
  The card is inserted before settlement (settle needs the cardId), so add a final
  `UPDATE scratch_cards SET net_credited_cents = $1 WHERE id = $2` inside the same
  transaction. No change to money math, cap, or provable-fair logic.
- `getScratchHistory`: also return `fundSource` and `netCreditedCents`
  (`COALESCE(net_credited_cents, prize_cents)`), keeping `prizeCents` (gross) too.

## History route — `apps/api/src/routes/games/history.ts`

- `/games/history/all` scratch branch: payout = `COALESCE(net_credited_cents,
  prize_cents)` (net for bonus, unchanged for cash/legacy). Also select
  `fund_source` for the scratch branch and pass a `fundSource` field through in the
  normalized output; the `bets` branch already carries its own funding via
  `gross_stake`/`winnings` (leave it; add `fund_source` there too if trivially
  available, else null) so the shape is uniform. Keep the 50-row limit + ordering.

## Web — scratch page + My Bets

- `apps/web/src/app/(player)/games/wingu-scratch/page.tsx`: `HistoryCard` gains
  `fundSource` + `netCreditedCents`; `cardToEntry` uses the net credited for the
  payout (so past bonus cards show net, consistent with the live post-buy display
  which already uses `displayedWinCents`). No toggle/UX change (already present).
- `apps/web/src/app/(player)/history/page.tsx` (My Bets): already renders `payout`
  from the API; now that the API returns net for bonus scratch, it is correct with
  no change. If it maps a `fundSource`, surface it; otherwise leave as-is.

## Toast logout reset — `apps/web/src/app/(player)/layout.tsx`

- When the profile transitions to null (logout) or on the logout handler, reset
  `prevBonusRef.current = null` so a re-login's first balance load re-seeds without
  a spurious toast. Trivial.

## Testing

- Migration applies (additive). `scratch.service`: a bonus buy records
  `fund_source='bonus'`, `bonus_grant_id`, and `net_credited_cents` = the net (cap
  applied); a cash buy records `fund_source='cash'` and `net_credited_cents =
  prizeCents`; a losing card sets net 0. Existing scratch tests stay green.
- `/games/history/all`: a bonus scratch card reports the net payout, not the gross.
- Web: tsc clean; scratch history maps net for bonus cards.

## Rollout

- Migration on API boot. Deploy API + Web. Smoke: /games/scratch/history 401;
  scratch buy + history reflect fund source; My Bets loads.

## Out of scope

- Backfilling legacy scratch rows' funding source.
- Any change to the scratch game math, RTP, stakes, or provable-fair seed logic.
- A bonus badge in the history UI (payout correctness only; badge is a later polish).
