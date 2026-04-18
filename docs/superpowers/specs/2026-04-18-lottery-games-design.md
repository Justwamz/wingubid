# Lottery Games + Promotions Banner Design

## Goal

Add two lottery game types to the Wingu Bet platform: a **scheduled draw lottery** (Pick 3, three draw tiers) and an **instant scratch card** game. Also add an **admin-configurable promotions banner** displayed at the top of the games lobby. All features integrate with the existing wallet, transaction, and authentication systems.

## Architecture

Two new game subsystems sharing the existing `authenticate` middleware, `debitForBet`/`creditWinnings` wallet service, and `transactions` table. A scheduler initialises on API startup alongside the existing Crash game loop. No new Render services required.

## Tech Stack

Node.js (Fastify 4), PostgreSQL (via `@betting/db` pool), `crypto.randomBytes` for RNG, Next.js 14 (React) frontend, existing Tailwind design tokens.

---

## Database Schema

### `lottery_draws`
Stores one row per scheduled draw event.

```sql
CREATE TABLE lottery_draws (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_type        VARCHAR(10) NOT NULL CHECK (draw_type IN ('hourly','daily','weekly')),
  ticket_price     BIGINT NOT NULL,
  scheduled_at     TIMESTAMPTZ NOT NULL,
  drawn_at         TIMESTAMPTZ,
  winning_numbers  INT[] ,
  status           VARCHAR(10) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','completed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lottery_draws_type_status ON lottery_draws(draw_type, status);
CREATE INDEX idx_lottery_draws_scheduled_at ON lottery_draws(scheduled_at);
```

### `lottery_tickets`
One row per ticket purchased by a player.

```sql
CREATE TABLE lottery_tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        UUID NOT NULL REFERENCES players(id),
  wallet_id        UUID NOT NULL REFERENCES wallets(id),
  draw_id          UUID NOT NULL REFERENCES lottery_draws(id),
  picked_numbers   INT[] NOT NULL,
  ticket_price     BIGINT NOT NULL,
  matched_count    INT,
  prize_cents      BIGINT NOT NULL DEFAULT 0,
  status           VARCHAR(10) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','won','lost')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lottery_tickets_player_id ON lottery_tickets(player_id);
CREATE INDEX idx_lottery_tickets_draw_id ON lottery_tickets(draw_id);
```

### `scratch_cards`
One row per scratch card purchased and resolved.

```sql
CREATE TABLE scratch_cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID NOT NULL REFERENCES players(id),
  wallet_id   UUID NOT NULL REFERENCES wallets(id),
  stake_cents BIGINT NOT NULL,
  grid        INT[] NOT NULL,
  prize_cents BIGINT NOT NULL DEFAULT 0,
  status      VARCHAR(10) NOT NULL DEFAULT 'completed',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_scratch_cards_player_id ON scratch_cards(player_id);
```

---

## Scheduled Draw Lottery

### Draw Schedule & Ticket Prices

| Tier   | Fires                        | Ticket Price |
|--------|------------------------------|--------------|
| Hourly | Every hour on the hour       | KES 20 (2000 cents) |
| Daily  | Every day at 20:00 EAT       | KES 100 (10000 cents) |
| Weekly | Every Sunday at 20:00 EAT    | KES 500 (50000 cents) |

### Prize Multipliers (applied to ticket price)

| Matches | Hourly | Daily  | Weekly  |
|---------|--------|--------|---------|
| 3 of 3  | ×100   | ×300   | ×1,000  |
| 2 of 3  | ×5     | ×8     | ×15     |
| 1 of 3  | ×1     | ×1     | ×1      |
| 0 of 3  | ×0     | ×0     | ×0      |

### Scheduler Logic (`apps/api/src/services/lottery-scheduler.ts`)

On API startup, three independent async loops initialise — one per draw tier. Each loop:

1. Queries DB for a `pending` draw of its type. If none exists, inserts a new one with the next correct `scheduled_at`.
2. Calculates `msUntilDraw = scheduledAt - Date.now()`. If negative (API was down when draw was due), fires immediately with `msUntilDraw = 0`. Otherwise sleeps.
3. On wake: generates 3 unique random integers (1–36) via `crypto.randomBytes`, marks draw `completed`, stores `winning_numbers`.
4. Queries all `pending` tickets for that `draw_id`. For each ticket, counts how many `picked_numbers` appear in `winning_numbers`. Computes prize using the multiplier table. Updates ticket `status`, `matched_count`, `prize_cents`. Calls `creditWinnings` for tickets with prize > 0.
5. Immediately loops back to step 1 to schedule the next draw.

RNG: shuffle `crypto.randomBytes(36)` array, take first 3 values mapped to 1–36. Same provably-fair pattern as Crash/Dice.

### API Routes

```
GET  /games/lottery/draws           List next draws per tier (3 rows: hourly/daily/weekly)
GET  /games/lottery/draws/:id       Draw details + winning_numbers (after completion)
POST /games/lottery/tickets         Buy ticket { drawType, pickedNumbers: [n,n,n] }
GET  /games/lottery/tickets/mine    Player's own ticket history (last 50)
```

All routes protected by existing `authenticate` middleware.

---

## Instant Scratch Card

### Grid Generation

A 3×3 grid (9 cells) is generated server-side at purchase using `crypto.randomBytes`. Each cell is assigned one of 6 symbols from a weighted pool:

| Symbol | Index | Weight | Category |
|--------|-------|--------|----------|
| 💎     | 0     | 2      | rare |
| 🌟     | 1     | 5      | uncommon |
| 🍀     | 2     | 8      | uncommon |
| 🔥     | 3     | 15     | common |
| 💰     | 4     | 15     | common |
| ❌     | 5     | 55     | no value |

Total weight: 100. Each cell independently sampled.

### Win Condition & Prizes

3 or more cells sharing the same non-❌ symbol = win. Prize = stake × multiplier:

| Matches | 💎   | 🌟   | 🍀   | 🔥/💰 |
|---------|------|------|------|-------|
| 3 cells | ×50  | ×20  | ×10  | ×4    |
| 4 cells | ×150 | ×60  | ×30  | ×10   |
| 5+ cells| ×500 | ×200 | ×100 | ×30   |

Prize computed immediately server-side. Wallet debited and credited (if won) in a single DB transaction before the response is sent. Client receives `grid[9]` + `prize_cents` and animates tile reveals client-side (300ms stagger) — result is already known.

### Stake Options

KES 20 / 50 / 100 / 200 (2000 / 5000 / 10000 / 20000 cents)

### API Routes

```
POST /games/scratch/buy       Buy + resolve { stake: number }
                              Returns { grid: int[9], prizeCents: number, cardId: string }
GET  /games/scratch/history   Player's last 20 scratch cards
```

---

## Frontend Pages

### `/games/lottery` — Draw Lottery

- Three draw tier cards (HOURLY / DAILY / WEEKLY) in a responsive row
- Each card: live countdown timer, ticket price, jackpot amount (match-3 prize), last drawn numbers
- Number picker: 1–36 grid, player taps to select exactly 3 numbers
- **Buy Ticket** button — disabled until 3 numbers selected
- "My Tickets" section below: pending tickets show picked numbers + draw time; settled tickets show matched count + prize
- `refreshBalance()` called after any prize credit

### `/games/scratch` — Scratch Card

- Stake picker: KES 20 / 50 / 100 / 200
- **Buy & Scratch** button
- 3×3 grid of face-down tiles; clicking/tapping reveals one at a time (300ms stagger animation)
- Win banner animates in when 3+ match detected
- Recent scratch history below (last 5 cards, symbol grid + prize)
- `refreshBalance()` called after each card

### Games Lobby (`/games`)

Both games added to existing grid:
- **LOTTO** card — "Pick 3, draw every hour" — links to `/games/lottery`
- **SCRATCH** card — "Instant win scratch cards" — links to `/games/scratch`

---

## Error Handling

- Duplicate ticket prevention: player can buy multiple tickets per draw but each is a separate row — no uniqueness constraint needed
- Draw fires while player is buying: the buy ticket route validates `draw.status = 'pending'` and `draw.scheduled_at > NOW()` before debiting. If the draw just completed, returns 422 `DRAW_CLOSED` and the player is not charged.
- Scratch card: entire buy+resolve in one DB transaction — no partial state possible
- Insufficient funds: existing `INSUFFICIENT_FUNDS` AppError from wallet service surfaces as 422

## Admin Stats

No changes needed. Lottery bets and scratch cards flow through the existing `transactions` table (`bet_placed` / `bet_won`), so `/admin/stats` automatically includes lottery revenue in `houseRevenue`, `totalBetVolume`, and `totalPaidOut`.

---

## Promotions Banner

### Overview

Two distinct banner placements with different audiences:

1. **Landing page** (`/`) — Static registration promo targeting new (unauthenticated) visitors. Not admin-configurable — hardcoded into the landing page hero section. Content: "Register & get KES 10,000 demo balance to play instantly."

2. **Games lobby** (`/games`) — Admin-configurable banner targeting **logged-in players**. Used for deposit bonuses, jackpot announcements, weekly promotions. Never used for registration CTAs (player is already logged in). Optional — if no banner is active, the game grid renders at the top.

### Database Schema

```sql
CREATE TABLE banners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  headline    VARCHAR(80)  NOT NULL,
  subtext     VARCHAR(160) NOT NULL DEFAULT '',
  cta_text    VARCHAR(40)  NOT NULL DEFAULT '',
  cta_url     VARCHAR(255) NOT NULL DEFAULT '/wallet/deposit',
  image_url   VARCHAR(500) NOT NULL DEFAULT '',
  gradient    VARCHAR(100) NOT NULL DEFAULT 'from-cyan-900/60 to-violet-900/40',
  active      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Only one banner active at a time. Activating one deactivates all others.

### Image Dimensions

Banner images display at **1200×300px** (4:1 ratio). Admin UI shows this spec clearly:
- Recommended: 1200×300px PNG or JPG
- Max file size: 500KB
- If no image provided, gradient background is used instead
- Image is stored as a URL (external link or uploaded to a CDN — for demo, admin pastes a URL directly; file upload is out of scope)

### First Demo Banner (seeded in migration)

```sql
INSERT INTO banners (headline, subtext, cta_text, cta_url, gradient, active)
VALUES (
  '💰 Deposit & Play — Double Your First Top-Up',
  'Add KES 500 or more and we match it. Play Crash, Mines, Dice, Lotto and Scratch.',
  'Top Up Now',
  '/wallet/deposit',
  'from-cyan-900/60 to-violet-900/40',
  true
);
```

### API Routes

```
GET  /games/banner                  Public (auth required) — active banner or null
GET  /admin/banners                 Admin — list all banners
POST /admin/banners                 Admin — create { headline, subtext, ctaText, ctaUrl, imageUrl, gradient }
PUT  /admin/banners/:id             Admin — update fields
PUT  /admin/banners/:id/activate    Admin — set active (deactivates others)
DELETE /admin/banners/:id           Admin — delete
```

`GET /games/banner` requires player JWT (banner is only shown to logged-in players).
Admin routes protected by `authenticateAdmin` middleware.

### Admin Dashboard UI

New **"Promotions"** tab on the admin dashboard:
- Table: headline, active badge, CTA, created date, Activate / Delete actions
- **+ New Banner** form with fields:
  - Headline (max 80 chars, character counter)
  - Subtext (max 160 chars)
  - CTA button text (max 40 chars)
  - CTA URL (default: `/wallet/deposit`)
  - Image URL — labelled **"Banner image URL (1200×300px recommended, max 500KB)"**
  - Gradient preset picker (5 colour options shown as swatches) — used when no image
- **Activate** button per row — goes live immediately
- Live preview of banner as it will appear to players

### Games Lobby UI (`/games`)

- Fetches `GET /games/banner` on load
- If banner returned: full-width card above game grid — image (if set) fills background, overlaid with headline, subtext, and CTA button
- If null: game grid starts at the top, no gap

### Landing Page Registration Promo

Existing landing page (`/`) gains a dedicated **"Registration Bonus"** section between the hero and the games grid:
- Static content: headline "Register free. Start with KES 10,000." + subtext + "Create Account →" CTA
- Styled with the site gradient, consistent with existing landing page design
- Visible only to unauthenticated visitors (page already redirects authenticated users to `/games`)
