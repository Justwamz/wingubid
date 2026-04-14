# Phase 3b — Crash, Mines & Dice Design Spec

**Date:** 2026-04-14
**Status:** Approved
**Scope:** Three self-built casino games (Crash, Mines, Dice) + shared game infrastructure + mobile-first player UI

---

## 1. Overview

Three provably fair, in-house casino games sharing the existing wallet service (Phase 3a) and a common sensory UI layer. No third-party provider dependencies — full control over house edge, margins, and UX.

**Games:**
- **Crash** — real-time multiplier climb, Socket.io, cash out before it crashes
- **Mines** — turn-based grid, reveal safe tiles, cash out before hitting a mine
- **Dice** — instant roll, neon slider, set win chance vs. payout

**New infrastructure this phase:**
- Render Redis instance provisioned and wired to `wingubid-api`
- `ioredis` client replacing the dummy `redis://localhost:6379`
- Socket.io embedded in Fastify via `fastify-socket.io`
- `game_settings` DB table (house edge, round timing)

---

## 2. Architecture

### 2.1 Service Topology

All game logic runs inside the existing `wingubid-api` Fastify service. No new Render service is needed except Redis.

```
Browser (apps/web)
  ├── /games                → lobby page
  ├── /games/crash          → Socket.io client ─────────────────────┐
  ├── /games/mines          → REST (HTTP)                            │
  └── /games/dice           → REST (HTTP)                            │
                                                                     │
wingubid-api (Fastify)                                               │
  ├── Socket.io server ◄────────────────────────────────────────────┘
  ├── crash-loop.ts         → setInterval(100ms) game state machine
  ├── crash.service.ts      → bet, cashout, settlement
  ├── mines.service.ts      → startGame, revealTile, cashout
  ├── dice.service.ts       → rollDice (stateless)
  ├── GET /games/leaderboard → last 10 wins, public
  └── GET /games/history    → player's own bets, authenticated

Redis
  ├── crash:round:current   → live round state
  └── mines:game:{gameId}   → active mines game state

PostgreSQL
  ├── game_rounds           → crash round history (already exists)
  ├── bets                  → all game bets (already exists, extends game_type)
  └── game_settings         → house edge, round timing (new)
```

### 2.2 New Files

**packages/db:**
```
migrations/011_game_settings.sql
```

**apps/api/src:**
```
lib/redis.ts                        — ioredis lazy singleton
lib/crash-rng.ts                    — provably fair RNG (shared pattern)
services/crash.service.ts           — crash bet/cashout/settlement
services/mines.service.ts           — mines game lifecycle
services/dice.service.ts            — dice roll (stateless)
game/crash-loop.ts                  — round state machine
game/crash-socket.ts                — Socket.io event handlers
routes/games/leaderboard.ts         — GET /games/leaderboard
routes/games/history.ts             — GET /games/history
```

**apps/web/src:**
```
app/(player)/games/page.tsx         — lobby
app/(player)/games/crash/page.tsx   — crash game
app/(player)/games/mines/page.tsx   — mines game
app/(player)/games/dice/page.tsx    — dice game
hooks/useCrashGame.ts               — Socket.io hook
hooks/useMinesGame.ts               — mines game state
components/game/MultiplierDisplay.tsx
components/game/BetPanel.tsx
components/game/MinesGrid.tsx
components/game/DiceSlider.tsx
components/game/RoundHistory.tsx
components/game/LiveLeaderboard.tsx
lib/sounds.ts                       — Web Audio API sound manager
lib/haptics.ts                      — navigator.vibrate() wrapper
```

---

## 3. Database

### 3.1 Migration 011 — game_settings

```sql
CREATE TABLE game_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      JSONB        NOT NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO game_settings (key, value) VALUES
  ('crash_house_edge',      '5'),
  ('crash_waiting_seconds', '5'),
  ('mines_house_edge',      '5'),
  ('dice_house_edge',       '1');
```

### 3.2 Migration 012 — extend bets.game_type

```sql
ALTER TABLE bets
  DROP CONSTRAINT bets_game_type_check,
  ADD CONSTRAINT bets_game_type_check
    CHECK (game_type IN ('crash', 'mines', 'dice', 'slot', 'virtual_sport'));
```

---

## 4. Redis

### 4.1 Provisioning

A Render Redis free-tier instance provisioned in Oregon (same region as the API) via Render API during deployment setup. `REDIS_URL` env var updated on `wingubid-api`.

### 4.2 Client — `apps/api/src/lib/redis.ts`

Lazy `ioredis` singleton, same pattern as `getPool()`:

```typescript
import Redis from 'ioredis'

let _redis: Redis | null = null

export function getRedis(): Redis {
  if (!_redis) {
    if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required')
    _redis = new Redis(process.env.REDIS_URL)
    _redis.on('error', (err) => console.error('Redis error', err))
  }
  return _redis
}
```

### 4.3 Key Schema

| Key | TTL | Contents |
|-----|-----|----------|
| `crash:round:current` | none | `CrashRoundState` object |
| `mines:game:{gameId}` | 30 min | `MinesGameState` object |

---

## 5. Provably Fair RNG — `apps/api/src/lib/crash-rng.ts`

Shared RNG module used by all three games.

### 5.1 Crash Point

```typescript
export function generateCrashPoint(
  serverSeed: string,
  clientSeed: string,
  roundNumber: number,
  houseEdge: number   // e.g. 5 for 5%
): number {
  const hash = createHmac('sha256', serverSeed)
    .update(`${clientSeed}-${roundNumber}`)
    .digest('hex')

  // ~3% instant crash
  if (hash[0] === '0') return 1.00

  const n = parseInt(hash.slice(0, 13), 16)
  const e = 100 - houseEdge
  return Math.max(1.00, Math.floor((e / (1 - n / 2 ** 52)) / 100) / 100)
}
```

### 5.2 Mines Position Generation

```typescript
export function generateMinePositions(
  serverSeed: string,
  clientSeed: string,
  gameId: string,
  totalTiles: number,
  mineCount: number
): number[] {
  // Build ordered tile array [0, 1, ..., totalTiles-1]
  const tiles = Array.from({ length: totalTiles }, (_, i) => i)

  // Deterministic Fisher-Yates shuffle driven by successive HMAC hashes
  for (let i = totalTiles - 1; i > 0; i--) {
    const hash = createHmac('sha256', serverSeed)
      .update(`${clientSeed}-${gameId}-${i}`)
      .digest('hex')
    const j = parseInt(hash.slice(0, 8), 16) % (i + 1)
    ;[tiles[i], tiles[j]] = [tiles[j], tiles[i]]
  }

  // First mineCount elements after shuffle are mine positions
  return tiles.slice(0, mineCount).sort((a, b) => a - b)
}
```

### 5.3 Dice Roll

```typescript
// Result is 0–99 (100 equally probable outcomes)
export function rollDiceResult(
  serverSeed: string,
  clientSeed: string,
  nonce: number   // increments per player roll, stored on bet row
): number {
  const hash = createHmac('sha256', serverSeed)
    .update(`${clientSeed}-${nonce}`)
    .digest('hex')
  return parseInt(hash.slice(0, 8), 16) % 100  // 0–99
}
```

---

## 6. Crash Game Engine

### 6.1 Round State (`CrashRoundState`)

```typescript
interface CrashRoundState {
  roundId: string
  roundNumber: number
  status: 'waiting' | 'running' | 'crashed'
  serverSeed: string        // kept secret until crash
  serverSeedHash: string    // published immediately
  clientSeed: string        // published immediately
  crashPoint: number        // kept secret until crash
  multiplier: number        // current live value
  waitingEndsAt: number     // epoch ms
  startedAt?: number
  bets: Record<string, {    // keyed by playerId
    betId: string
    effectiveStake: number
    autoCashoutAt?: number
  }>
}
```

### 6.2 Game Loop — `apps/api/src/game/crash-loop.ts`

```
startCrashLoop():
  on startup: check Redis for existing round
    if 'running' found: settle all active bets as lost, start fresh WAITING
    if 'waiting' found: continue from current state
    if nothing: create new WAITING round

  setInterval(100ms):
    WAITING:
      if now >= waitingEndsAt → transition to RUNNING, broadcast round:started
    RUNNING:
      increment multiplier (exponential growth)
      check each bet.autoCashoutAt → trigger server-side cashout if reached
      broadcast round:tick { multiplier }
      if multiplier >= crashPoint → CRASHED
    CRASHED:
      settle all remaining active bets as lost (DB transaction)
      update game_round record with serverSeed + crashPoint
      broadcast round:crashed { crashPoint, serverSeed }
      after 2s: create new WAITING round, loop
```

**Multiplier growth formula:**
```
elapsed = (Date.now() - startedAt) / 1000   // seconds
multiplier = Math.pow(Math.E, 0.00006 * elapsed * elapsed)
```
This gives a slow start (~1.00×) accelerating to large multipliers — standard Aviator feel.

### 6.3 Socket.io — `apps/api/src/game/crash-socket.ts`

**Handshake auth:** JWT verified on `connection` event. Socket rejected if token invalid.

**Events handled:**

`bet:place { grossStake, autoCashoutAt? }`
- Validate: status must be 'waiting', player has no active bet this round
- Call `crash.service.placeBet()` → debitForBet → add to Redis round state
- Emit `bet:confirmed` to socket

`bet:cashout {}`
- Validate: status must be 'running', player has active bet
- Read current multiplier from round state
- Call `crash.service.cashout()` → creditWinnings
- Emit `cashout:confirmed { multiplier, winnings }` to socket
- Emit `cashout:broadcast { playerName, multiplier, winnings }` to room (leaderboard feed)

**Error response:** `bet:error { code, message }` to emitting socket only.

### 6.4 Crash Service — `apps/api/src/services/crash.service.ts`

```typescript
placeBet(playerId, roundId, grossStake, autoCashoutAt?): Promise<Bet>
cashout(playerId, roundId, multiplier): Promise<{ winnings: number }>
settleLostBets(roundId, activeBetIds): Promise<void>
getRecentRounds(limit): Promise<GameRound[]>
```

All money operations use the existing `wallet.service.ts` — no wallet logic duplicated here.

---

## 7. Mines Game

### 7.1 Game State (`MinesGameState`)

```typescript
interface MinesGameState {
  gameId: string
  playerId: string
  gridSize: number          // 3, 4, or 5
  mineCount: number
  minePositions: number[]   // secret until game ends
  serverSeed: string        // secret until game ends
  serverSeedHash: string
  clientSeed: string
  revealedTiles: number[]
  effectiveStake: number
  currentMultiplier: number
  status: 'active' | 'won' | 'lost'
  betId: string
}
```

### 7.2 Mines Service — `apps/api/src/services/mines.service.ts`

**`startGame(playerId, grossStake, gridSize, mineCount)`**
- Validate: gridSize ∈ {3,4,5}, mineCount < totalTiles, player has no active mines game
- Call `debitForBet()`
- Generate mine positions with provably fair RNG
- Store state in Redis (30 min TTL)
- Return `{ gameId, serverSeedHash, clientSeed, gridSize, mineCount }`

**`revealTile(playerId, gameId, tileIndex)`**
- Load state from Redis, validate ownership + status active + tile not already revealed
- Check if mine:
  - **Mine hit:** settle bet as `lost`, reveal all mine positions, clear Redis
  - **Safe:** add to revealedTiles, recalculate multiplier, update Redis
- Return `{ safe: boolean, multiplier?, minePositions? }`

**`cashout(playerId, gameId)`**
- Load state, validate active
- Call `creditWinnings(effectiveStake × currentMultiplier)`
- Mark won, reveal mine positions, clear Redis
- Return `{ winnings, minePositions, serverSeed }`

**Multiplier formula:**
```
totalTiles = gridSize²
safeTiles  = totalTiles - mineCount
revealed   = revealedTiles.length + 1   // next tile about to be safe
multiplier = (1 - houseEdge/100) / hypergeometric_probability(revealed, totalTiles, safeTiles)
```
Simplified for implementation:
```
p_safe = (safeTiles - revealed + 1) / (totalTiles - revealed + 1)
multiplier_new = multiplier_prev / p_safe
```
Starting multiplier = `1 / (safeTiles / totalTiles) × (1 - houseEdge/100)`.

### 7.3 Routes

```
POST /games/mines/start      { grossStake, gridSize, mineCount }  → game state
POST /games/mines/reveal     { gameId, tileIndex }                → reveal result
POST /games/mines/cashout    { gameId }                           → winnings + mine positions
```

All routes require JWT authentication.

---

## 8. Dice Game

### 8.1 Dice Service — `apps/api/src/services/dice.service.ts`

**`rollDice(playerId, grossStake, target, direction)`**
- `direction`: `'over'` or `'under'`
- `target`: 1–98 (displayed to player as 1–98; maps to 0-based result space internally)
- Result: `rollDiceResult()` returns 0–99
- Win condition: `direction === 'over' ? result >= target : result < target`
- Win count: `direction === 'over' ? (100 - target) : target` (out of 100)
- Win chance %: `winCount / 100 * 100` (displayed to player)
- Payout multiplier: `(100 - houseEdge) / winCount` (e.g. target=50 over: 50 wins, multiplier = 99/50 = 1.98×)
- Call `debitForBet()` then immediately `creditWinnings()` if won, else settle `lost`
- Returns `{ result, won, multiplier, winnings, serverSeed, clientSeed, nonce }`

Entirely stateless — no Redis, no pending state.

### 8.2 Routes

```
POST /games/dice/roll    { grossStake, target, direction }   → roll result
```

Requires JWT authentication.

---

## 9. Shared Game Routes

### 9.1 `GET /games/leaderboard`

No authentication required. Returns last 10 winning bets across all three games:

```typescript
[{
  playerName: string,   // first name only
  game: 'crash' | 'mines' | 'dice',
  multiplier: number,
  winnings: number,     // in cents
  currency: string,
  wonAt: string
}]
```

Queried from `bets` table, cached in Redis for 5 seconds.

### 9.2 `GET /games/history`

Authenticated. Returns player's last 50 bets across all games.

---

## 10. Frontend

### 10.1 Design System

**Shared sensory layer:**

`apps/web/src/lib/sounds.ts` — Web Audio API, preloads on first user interaction:
- `sounds.win()` — bright ascending chime
- `sounds.lose()` — low thud
- `sounds.tick()` — soft click (crash multiplier tick)
- `sounds.roll()` — metallic clink (dice)
- `sounds.mineHit()` — explosion rumble
- `sounds.cashout()` — cash register

`apps/web/src/lib/haptics.ts` — `navigator.vibrate()` wrapper:
- `haptics.win()` — long pulse (200ms)
- `haptics.lose()` — double short pulse (50ms, 50ms)
- `haptics.roll()` — single short pulse (30ms)
- `haptics.tick()` — minimal pulse (10ms)

**Visual language:**
- Background: `#0a0a0f` (near-black)
- Neon green: `#00ff88` (winning state)
- Neon red: `#ff3355` (losing/crash state)
- Neutral: `#4a4a6a`
- Font: system monospace for numbers (crisp on mobile)
- All interactive elements minimum 48px touch target

### 10.2 Game Lobby — `/games`

Three full-width cards stacked vertically (mobile). Each card shows:
- Game name + icon
- Live ambient stat (current multiplier / active games / last result)
- "Play" button

Lobby polls `GET /games/leaderboard` every 5s — the live leaderboard strip runs across the bottom of all game pages.

### 10.3 Crash UI — `/games/crash`

**`MultiplierDisplay`** (top 55% of screen):
- Large monospace number: `1.23×`
- Neon green glow pulsing in sync with each tick (CSS box-shadow animation)
- On crash: instant red flash, number freezes, "CRASHED @ X.XX×" overlay
- Waiting: countdown timer with progress ring

**`BetPanel`** (middle):
- Amount input with quick-select chips (+100, +500, +1000)
- Auto-cashout field (collapsed by default — tap to expand: progressive disclosure)
- Single button changes label + color by state:
  - WAITING: "Place Bet" (green)
  - WAITING + bet placed: "Bet Placed ✓" (grey, disabled)
  - RUNNING + active bet: "Cash Out @ 1.23×" (green, pulses)
  - RUNNING + no bet: disabled
- On bet confirm: brief scale animation (micro-animation) + `sounds.cashout()`

**`RoundHistory`** (horizontal strip, bottom):
- Last 20 crash points, colour-coded pills: red < 2×, yellow 2–10×, green > 10×

**`LiveLeaderboard`** (overlay strip):
- Slides in from right when a player cashes out
- Shows: "Player cashed out at X.XX× — KES Y"
- Auto-dismisses after 3s

Near-miss visual: if crash point is within 0.05× of player's auto-cashout target, multiplier display briefly flickers (CSS shake, 200ms) before showing crash — no celebratory sound.

### 10.4 Mines UI — `/games/mines`

**Bet panel** (top): stake input + grid size selector (3×3, 4×4, 5×5) + mine count slider. "Start Game" button.

**`MinesGrid`** (centre):
- CSS grid of face-down tiles (dark, slightly glossy)
- Tap to reveal: tile flips (CSS perspective transform, 300ms)
  - Safe: gem icon, neon green glow, `sounds.win()` + `haptics.win()`
  - Mine: explosion icon, red flash across whole grid, `sounds.mineHit()` + `haptics.lose()`
- Remaining mine count displayed as pill above grid

**Multiplier + cashout** (bottom):
- Current multiplier shown prominently in neon green
- "Cash Out — KES X" button (large, green) — always visible during active game
- On cashout: all mine positions revealed with red X, `sounds.cashout()`

### 10.5 Dice UI — `/games/dice`

**Slider** (centre of screen):
- Full-width neon gradient slider, 0–99
- Left of target: green (win zone for "under") / right: red
- Flips on "over"/"under" toggle
- Win chance % and payout multiplier update live as slider moves

**Bet panel** (below slider):
- Stake input + direction toggle ("Roll Over" / "Roll Under")
- Large "Roll" button

**Result animation:**
- Winning number animates in from top (CSS translate + fade)
- Win: number lands in green zone, `sounds.roll()` + `haptics.roll()`, neon green flash
- Lose: number lands in red zone, same sounds, muted grey flash (no celebration)

**History strip** (bottom): last 10 rolls, coloured dots (green/red)

### 10.6 `useCrashGame` Hook

```typescript
const {
  round,          // current round state
  multiplier,     // live value
  myBet,          // player's active bet or null
  placeBet,       // (grossStake, autoCashoutAt?) => void
  cashout,        // () => void
  recentRounds,   // last 20 crash points
} = useCrashGame()
```

Manages Socket.io connection. On reconnect: re-joins `crash` room, server emits current state immediately. Auto-reconnect with exponential backoff (Socket.io default).

---

## 11. Error Handling

| Scenario | Behaviour |
|---|---|
| API restart mid-crash-round | On startup, settle all active round bets as `lost`, start fresh WAITING |
| API restart mid-mines-game | Redis TTL (30 min) — if `revealTile` or `cashout` finds no Redis key for a bet with `status='active'`, it settles the bet as `lost` in DB and returns `{ expired: true }` to client |
| Socket disconnect during round | Client auto-reconnects, server state unchanged, bet intact |
| Dice service DB failure | Transaction rolls back, player balance unchanged, error returned |
| Redis unavailable | Crash game loop pauses, returns 503 on game endpoints, HTTP routes unaffected |

---

## 12. Testing Strategy

- **Unit:** RNG functions (deterministic given fixed seeds), multiplier formula, mines position generation, dice win/loss logic
- **Service integration:** crash bet/cashout/settlement (mock wallet service), mines full game lifecycle, dice roll with wallet debit/credit
- **Socket.io:** Vitest + `socket.io-client` — place bet, cashout, auto-cashout, disconnect/reconnect
- **No E2E automation for MVP**

---

## 13. Render Deployment

### New: Redis instance
- Provision Render Redis (free tier, Oregon) via API during this phase
- Update `REDIS_URL` env var on `wingubid-api`

### No new services
All game logic runs in the existing `wingubid-api` instance. Frontend runs in existing `wingubid` instance.
