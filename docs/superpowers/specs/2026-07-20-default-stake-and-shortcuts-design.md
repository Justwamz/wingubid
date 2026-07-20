# Default stake + stake shortcuts — Design

**Date:** 2026-07-20
**Status:** Approved

## Goal

Make placing a bet faster and lower-friction across the free-text stake games:

1. **Default stake** — pre-fill KES 50 in the stake box so a user who doesn't
   type an amount can still place a bet in one tap (the amount stays editable).
2. **Stake shortcuts** — a consistent quick-select row `50 / 100 / 200 / 500 /
   1000` on every free-text game. Tapping a button **sets** the stake to that
   exact amount.

## Scope

Web only, presentational. Applies to the three free-text-stake games:
**Crash, Mines, Dice**. Scratch keeps its existing product tiles (20/50/100/200)
but its **default selection** moves to the 50 tile. Lotto is untouched
(fixed draw-tier prices, no free stake box, no 50 tier).

Per-game admin configurability is explicitly **out of scope** (phased — future
spec). The shared constant below is the seam the future admin default will
fall back to.

## Design

### 1. Shared config — `apps/web/src/lib/gameConfig.ts` (new)
```ts
export const DEFAULT_STAKE_KES = 50
export const STAKE_SHORTCUTS = [50, 100, 200, 500, 1000]
```
Single source of truth for the default amount and the shortcut set.

### 2. Shared component — `apps/web/src/components/game/QuickStakes.tsx` (new)
Presentational row of buttons rendered from `STAKE_SHORTCUTS`.
- Props: `onSelect(value: number)`, `disabled?: boolean`, `activeValue?: number`.
- Tapping a button calls `onSelect(v)`; the consuming game sets its stake state
  to `String(v)` (SET semantics).
- The button matching `activeValue` is highlighted.
- Keeps amounts, behavior, and appearance identical across all three games.

### 3. Wire into games
- **Crash** — `apps/web/src/components/game/BetPanel.tsx`
  - Stake state default: `useState('')` → `useState(String(DEFAULT_STAKE_KES))`.
  - Replace the inline `[100, 500, 1000]` button block (which used misleading
    "+" labels) with `<QuickStakes onSelect={v => setStake(String(v))}
    disabled={!canBet} activeValue={parseInt(stake) || undefined} />`.
- **Mines** — `apps/web/src/app/(player)/games/wingu-mines/page.tsx`
  - Stake state default → `String(DEFAULT_STAKE_KES)`.
  - Add `<QuickStakes>` under the stake input, wired to `setStake`.
- **Dice** — `apps/web/src/app/(player)/games/wingu-dice/page.tsx`
  - `grossStake` default → `String(DEFAULT_STAKE_KES)`.
  - Add `<QuickStakes>` under the stake input, wired to `setGrossStake`.
- **Scratch** — `apps/web/src/app/(player)/games/wingu-scratch/page.tsx`
  - Default `selectedStake` moves from `STAKES[0].cents` (20) to the tile whose
    cents === `DEFAULT_STAKE_KES * 100` (5000), falling back to `STAKES[0]` if
    no matching tile exists. No shortcut row added (Scratch is already a picker).

## Resulting behavior

Crash, Mines, Dice open with 50 pre-filled and the shortcut row visible;
"Place Bet" / action button is immediately active. Tapping a shortcut sets the
exact amount and highlights it. The box remains freely editable. Scratch opens
with the 50 tile selected.

## Accepted trade-off

These three games previously disabled their action button until an amount was
typed. With a pre-filled default, an accidental tap now places a real KES 50
bet. This is intentional (the point of the feature) and acknowledged.

## Testing

Load Crash, Mines, Dice and confirm: 50 pre-filled on open; action button
active; shortcut row shows 50/100/200/500/1000; tapping sets the box and
highlights the button; box still editable. Load Scratch: 50 tile selected by
default. Typecheck (`tsc --noEmit`) clean; `next dev` compiles all affected
routes with no errors.
