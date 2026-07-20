# Bet history across all games + combined "My Bets" — Design

**Date:** 2026-07-20
**Status:** Approved

## Goal

Give every game a consistent per-player bet-history panel, and add a combined
"My Bets" page (all games) in the Profile section. Rows show **core fields only**
(uniform): outcome, stake, multiplier (if any), payout, time.

## Current state (from exploration)

- **Mines / Scratch** — already have API-backed per-player history panels.
- **Lotto** — has "My Tickets" (API-backed) but a filter bug (`status === 'settled'`
  vs actual `'won'/'lost'`) hides settled tickets.
- **Crash** — data + API exist (`/games/history`), but no per-player UI (only a
  global recent-crashes strip).
- **Dice** — "Recent Rolls" is client-only, lost on reload.

Data is already persisted for all games (`bets` for crash/mines/dice,
`scratch_cards`, `lottery_tickets`). No DB migration needed.

## Design

### 1. Shared presentational component — `apps/web/src/components/game/BetHistory.tsx`
```ts
export interface BetHistoryEntry {
  id: string
  game?: string            // shown only when showGame is true (combined page)
  stake: number            // cents
  status: string           // 'won' | 'lost' | 'active' | 'pending' | 'refunded'
  payout: number           // cents (0 when not won)
  multiplier?: number | null
  createdAt: string
}
```
Renders a titled card with a uniform table: `[Game?] Result · Stake · Mult · Payout · Time`.
Handles loading / error / empty states. `won` → cyan "WON", `lost` → coral "LOST",
anything else → neutral label. Time shown relative (e.g. "2m", "3h", "5d").

### 2. Core-bet hook — `apps/web/src/lib/useBetHistory.ts`
`useCoreBetHistory(game)` fetches `/games/history`, filters to the given
`game_type`, and maps rows → `BetHistoryEntry[]`, returning `{ entries, loading, error }`.
Used by the crash/mines/dice panels (all three read the `bets`-backed endpoint).

### 3. Per-game panels
- **Crash** — new `<GameBetHistory game="crash">` panel below the game (keeps the
  separate global RoundHistory strip; that's a different feature).
- **Dice** — replace the ephemeral "Recent Rolls" with `<GameBetHistory game="dice">`
  (survives reloads).
- **Mines** — replace `MinesHistory` with `<GameBetHistory game="mines">` (delete
  the old component).
- **Scratch** — convert "Recent Cards" to the shared `<BetHistory>` (map the
  existing `scratch_cards` history state; keep the fetch-on-mount + prepend-on-buy
  behavior). Grid thumbnail dropped (core-fields-only).
- **Lotto** — **fix the settled-filter bug** (`'settled'` → `'won'|'lost'`). Lotto
  keeps its purpose-built "My Tickets" (it tracks *pending future draws*, not just
  past bets, and the combined page carries its uniform core-field row). This is the
  one intentional exception to the uniform per-game panel.

`GameBetHistory` (crash/mines/dice wrapper) lives in
`apps/web/src/components/game/GameBetHistory.tsx`.

### 4. Combined API endpoint — `GET /games/history/all` (auth)
Added to `apps/api/src/routes/games/history.ts`. `UNION ALL` over the three
sources into the normalized shape with a `game` label:
- `bets` → stake=`gross_stake`, multiplier=`cashout_multiplier`, payout=`winnings`, status
- `scratch_cards` → game `scratch`, stake=`stake_cents`, payout=`prize_cents`,
  status = prize>0 ? 'won' : 'lost'
- `lottery_tickets` → game `lotto`, stake=`ticket_price`, payout=`prize_cents`, status
- `ORDER BY created_at DESC LIMIT 50`.

### 5. Combined "My Bets" page — `apps/web/src/app/(player)/history/page.tsx`
Fetches `/games/history/all`, renders `<BetHistory showGame>`. Linked from a new
"My Bets" row in the dashboard Account section (next to Withdraw).

## Testing

`tsc --noEmit` clean; `next dev` compiles all five game routes, `/history`, and
`/dashboard`. API builds. The combined SQL is verified for shape; full row-level
behavior needs a logged-in player with real bets.

## Out of scope

Game-specific detail in rows (dice roll, lotto numbers, scratch grid), pagination,
and per-game dedicated routes. Core fields only, per the chosen approach.
