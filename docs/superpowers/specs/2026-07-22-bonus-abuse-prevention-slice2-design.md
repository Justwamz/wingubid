# Bonus eligibility & abuse prevention (Slice 2) — design

**Date:** 2026-07-22
**Status:** Approved for planning
**Part of:** the bonus system. Slice 2 of 3 (Slice 1 = engine, shipped; Slice 3 = campaigns/claims).

## Problem

The bonus rules limit a bonus to "one per customer" and once per account, phone,
IP address, device, household, and public/shared network. Slice 1 enforces only
"one active bonus per player." Nothing captures IP or device, and there is no
cross-account duplicate detection. This slice builds the capture + a reusable
eligibility engine and wires it into the admin grant flow (Slice 3's self-service
claims will reuse the engine).

## Reality constraints (drove the decisions)

- Players are Safaricom-only (Kenyan mobile). Carrier NAT means many legitimate
  users share one public IP, so IP can never be a blind hard block.
- "Household" and "public/shared network" are not directly detectable; they
  reduce to IP heuristics (same IP; many accounts per IP).
- IPs are PII-adjacent: stored for fraud prevention only, shown only to
  permission-gated admins, never exposed to players or externally.

## Decisions (locked with the user)

- Deterministic checks (account already has an active bonus) hard-block; IP /
  device / household / network raise **flags** for admin review, plus a
  configurable IP-velocity auto-block (off by default).
- Device identity = a first-party opaque id (random, stored in the browser's
  localStorage, sent on signup). No fingerprint library, no PII.
- Household = same exact public IP; shared/public network = many accounts per IP
  (velocity). Both are flags (no /24 grouping in this slice).
- Enforcement point this slice = the admin grant flow, via a reusable engine.
- Warn flags never block the grant; they are shown + logged. Only block-severity
  (velocity over the auto-block threshold) requires an explicit override.

## Data model — migration `038_player_signals.sql`

```sql
-- Fraud/abuse signals captured per player. Extensible via `kind`; Slice 3 adds
-- 'claim'. IP stored as inet; device_id is a first-party opaque token.
CREATE TABLE player_signals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind       VARCHAR(12) NOT NULL CHECK (kind IN ('signup','login','claim')),
  ip         INET,
  device_id  VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_player_signals_player_id ON player_signals(player_id);
CREATE INDEX idx_player_signals_ip ON player_signals(ip) WHERE ip IS NOT NULL;
CREATE INDEX idx_player_signals_device ON player_signals(device_id) WHERE device_id IS NOT NULL;
```

Config in `game_settings` key `bonus_abuse` (JSONB), read with defaults so the
migration seeds nothing:
- `ipVelocityFlag` (default `3`) — flag when at/above this many distinct accounts
  share the IP.
- `ipVelocityBlock` (default `0` = disabled) — auto-block (block-severity) when
  at/above this many; `0` disables (safe default given carrier NAT).

## Capture

- `apps/api/src/services/auth.service.ts` `registerPlayer` gains `ip?: string`
  and `deviceId?: string` on `RegisterInput`, and inserts a `player_signals` row
  (`kind='signup'`) inside the same transaction that creates the player (atomic;
  works for both the instant-signin and OTP paths since the player row is created
  there).
- `apps/api/src/routes/auth/register.ts` passes `ip: req.ip` (trustProxy already
  on) and `deviceId` from the request body (optional string, max 64 chars).
- Web: `apps/web/src/lib/device.ts` `getDeviceId()` returns a stable random id
  from `localStorage` (key `wb_device_id`), creating it if absent
  (`crypto.randomUUID()`), and the register request includes it as `deviceId`.

## Eligibility engine

`apps/api/src/services/bonus-eligibility.service.ts`:

```ts
export type FlagType = 'prior_bonus' | 'device_bonus' | 'ip_bonus' | 'ip_velocity'
export interface EligibilityFlag {
  type: FlagType
  severity: 'warn' | 'block'
  message: string
  count?: number
  matchedPlayerIds?: string[]
}
export async function evaluateBonusEligibility(playerId: string): Promise<{ flags: EligibilityFlag[] }>
```

Logic (all queries scoped so a player never matches itself):
- **prior_bonus** (warn): the player already has any `bonus_grants` row.
- **device_bonus** (warn): another player who shares any of this player's
  `signup` `device_id`s has a `bonus_grants` row. Include matched player ids +
  count.
- **ip_bonus** (warn): another player who shares any of this player's `signup`
  `ip`s has a `bonus_grants` row (household signal).
- **ip_velocity**: distinct player count sharing this player's `signup` ip(s). If
  `>= ipVelocityBlock` (and block enabled) -> severity `block`; else if
  `>= ipVelocityFlag` -> severity `warn`.

Returns an empty `flags` array for a clean player (no signals, no matches).

## Enforcement — admin grant

`apps/api/src/routes/admin/bonuses.ts`:
- New `GET /admin/bonuses/eligibility` (gated `bonuses.view`), query `phone` (or
  `playerId`): resolves the player and returns `{ playerId, flags }` for the grant
  form to preview. 404 if no player.
- `POST /admin/bonuses/grant` gains `override?: boolean`. After resolving the
  player and the existing active-bonus check, it runs `evaluateBonusEligibility`:
  - If any flag has severity `block` and `override !== true` -> `409
    { code: 'ABUSE_BLOCKED', message, flags }`.
  - Otherwise proceed. All flags (and `override`) are written into the
    `admin_audit_log` `after` payload and the grant's audit for later review.

## Admin UI — Bonuses tab

- When a phone is entered (on blur or a "Check" button), call the eligibility
  preview and render the flags: device/IP bonus matches (with counts), IP velocity
  (with count), prior-bonus notice. Block-severity shows a red banner and an
  "Override and grant anyway" checkbox that sets `override: true`.
- Warn flags render as an amber notice; the grant button stays enabled.
- IPs/device ids are shown here (permission-gated `bonuses.view`) for fraud triage
  only.

## Testing

- `bonus-eligibility.service`: prior_bonus flag; device_bonus match (another
  bonus recipient shares device); ip_bonus match; ip_velocity warn vs block
  thresholds; clean player -> no flags; a player never matches itself.
- Register route/service: a signup inserts a `player_signals` row with the ip +
  deviceId; missing deviceId still records ip.
- Admin routes: eligibility preview returns flags; grant is blocked 409
  `ABUSE_BLOCKED` on a block-severity flag without override, succeeds with
  `override: true`; warn flags do not block and are audited.
- Existing bonus/grant tests stay green (no flags for players without signals).

## Rollout

- Migration on API boot; additive (new table + optional columns of behavior).
- Deploy API, then Admin, then Web. Existing players simply have no signals.
- Verify: API tsc + full vitest; admin/web tsc; prod smoke of
  `/admin/bonuses/eligibility` (401 unauth).

## Out of scope (Slice 3 / later)

- Self-service claim flow + claim-time signal capture and enforcement.
- Login-time signal capture, FingerprintJS, /24 subnet grouping, VPN/proxy
  detection, geo checks.
