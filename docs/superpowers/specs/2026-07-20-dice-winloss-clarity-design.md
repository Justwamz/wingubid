# Dice win/lose clarity — Design

**Date:** 2026-07-20
**Status:** Approved

## Problem

The dice game gives no visual clarity on why a player wins or loses:
- The slider is a plain grey track — the win zone isn't shown.
- After a roll, a 6-sided die face is shown, but the roll is a 0–99 number, so
  the die metaphor is misleading and doesn't show where the number landed
  relative to the target.

## Goal

Make win/lose self-evident by turning the slider into the result surface: a
two-colour track (win/lose zones split at the target) with a marker that lands
on the exact rolled number.

## Scope

Web only, dice game. Build the core clarity fix (zoned track + landing marker
with a smooth animation). Extras (rolling-ball flourish, payout burst,
near-miss, sound) are explicitly out of scope — the track structure supports
adding them later without rework.

## Visual system

Stay within the app's existing dark-neon identity (do not invent a new one):
- Win zone: dice green `#00C896`; lose zone: coral `#FF4E50` (existing
  warning-coral). Track base on `game-bg`/`game-border`. Mono type.
- The signature element is the interactive track itself: the target handle is
  the boundary between a glowing win zone and a lose zone, and the rolled number
  drops onto the track inside one of them.

## Components

### `DiceTrack` (new) — `apps/web/src/components/game/DiceTrack.tsx`
Props: `target: number`, `onChange: (n) => void`, `direction: 'over' | 'under'`,
`result: number | null`, `won: boolean | null`, `rolling: boolean`.

- Axis 0–100; `pos(v) = v` as a percentage.
- Zones (absolutely-positioned): for `over`, win = target→100 (green),
  lose = 0→target (coral); for `under`, win = 0→target (green),
  lose = target→100 (coral).
- Target boundary: a divider line at `target%` with the target value label.
- Interaction: a native `range` input (min 1, max 99) overlaid transparently
  for drag + keyboard accessibility, so changing the target moves the win/lose
  boundary live. `aria-label` describes the target.
- Result marker: when `result != null`, a pointer + number bubble positioned at
  `result%`, coloured green (won) or coral (lost). Animates its position with a
  CSS transition; wrapped in `prefers-reduced-motion` so it snaps for users who
  opt out.

### Dice page — `apps/web/src/app/(player)/games/wingu-dice/page.tsx`
- Replace `<DiceSlider>` with `<DiceTrack>`, passing direction + result.
- Remove the `<DiceFace>` (retire the misleading die). Keep a clean result
  readout: big number + WIN/LOSS + payout, coloured to match.
- Direction buttons, stats (target / win chance / multiplier), stake controls,
  and history stay unchanged.

### Cleanup
- Delete `DiceSlider.tsx` (now unused, no test).
- Keep `DiceFace.tsx` (has its own test; just no longer used on the dice page).

## Copy

- Above the track: a plain-language bet line, e.g. "Roll above 50 to win"
  (mirrors HIGH/LOW + target), so the coloured zones are explained in words too.

## Testing

`tsc` clean; component test for `DiceTrack` (zone sides by direction; marker
colour by `won`); `next dev` compiles the dice route; visual check of win and
loss states.
