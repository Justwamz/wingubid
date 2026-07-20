# Dice: comprehension redesign + rolling animation — Design

**Date:** 2026-07-20
**Status:** Approved

## Problem

Player feedback: the dice game is not understood at all — unclear what you bet
on, the two controls (target + HIGH/LOW) are confusing, there's no feeling of
"rolling", the multiplier changes are unexplained, and it doesn't obviously tie
to "dice". Adding polish to a confusing game doesn't help; comprehension must be
fixed first, with the animation layered on top.

## Goal

Make the whole loop obvious — read one sentence, roll, watch the number tumble
and land in the green or red zone, see the payout — and give a real rolling
moment so the player knows a roll is happening.

## Scope

Web only, dice game. Builds on the existing `DiceTrack` (green/red zones).

## Design (mapped to each confusion)

### 1. One plain-English bet sentence — "what am I betting on" + "two controls"
A single always-visible line replaces the separate direction buttons + stats:
> Bet the roll lands **[ OVER | UNDER ]** **50** — win **KES 100**

- `[ OVER | UNDER ]` is a compact segmented toggle (renamed from HIGH/LOW).
- The number is the player's line (dragged on the track).
- "win KES N" is the live potential payout = `floor(stake × multiplier)`.

### 2. Logic explainer — "logic / how it ties to dice"
Permanent one-liner under the title: *"A random number from 0–100 is rolled —
you win if it lands in your green zone."* Sets the mental model; stops implying
physical dice.

### 3. Rolling animation — "no feeling of playing"
On ROLL:
- The big number display spins like an **odometer** (random 0–100 every ~60ms).
- The track marker sweeps with the spin (driven by the same live value).
- The API result is awaited; the spin runs a **minimum ~1.4s** for suspense.
- Then it **lands**: marker glides (0.6s) to the final number and snaps into the
  green/red zone; win → green flash + payout **pop**, loss → muted.

### 4. Chance / multiplier line — "why the multiplier changes"
Live: *"50% chance · pays 2.00×"* with a hint *"Smaller green zone = bigger
payout."* Dragging the line updates chance and multiplier together.

## Components

- `DiceTrack` — add `rollingValue: number | null`. While non-null, the marker
  tracks it (fast transition, neutral colour). Otherwise it lands on `result`
  (0.6s transition, coloured by `won`).
- `globals.css` — `.dice-marker-spin` (fast), `.dice-marker-land` (glide),
  `.dice-pop` (win payout pop); all disabled under `prefers-reduced-motion`.
- Dice page — spin state + coordinated roll (min-duration + API), the bet
  sentence, explainer, chance/multiplier line, odometer number.

## Testing

`tsc` clean; `DiceTrack` tests updated for the new prop (rolling shows the live
value; result colours by won); full web suite passes; `next dev` compiles the
dice route.

## Out of scope

Sound effects, near-miss shake. Can be added later without rework.
