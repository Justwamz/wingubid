# Per-game live chat + moderation (Wingu Crash first) - Design

**Date:** 2026-07-20
**Status:** Approved

## Goal

A YouTube-live-style chat on Wingu Crash, with player-chosen usernames, an
admin moderation surface, automatic abuse handling, and a per-game on/off
kill-switch. Built per-game so more games can be added later; only `crash` is
wired in v1.

## Architecture

Reuse the existing socket.io server (same JWT auth on connect). New room
`chat:crash`. A dedicated `registerChatSocket(io)` connection handler + a
realtime helper module holding the `io` reference so HTTP moderation routes can
broadcast (delete / disable). Client uses a `useGameChat` hook (its own socket).

Single API instance today, so rooms + a DB table are sufficient. Multi-instance
would need the socket.io-Redis adapter (noted, not built).

## Data (migration 034)

- `players.chat_username` VARCHAR(20), unique on `LOWER(chat_username)`.
- `chat_messages`: game, player_id -> players, username (snapshot), text,
  created_at, deleted_at, deleted_by -> admin_users.
- `chat_bans`: player_id, until (null = permanent), reason, created_by
  ('system' or admin id), created_at.
- `chat_banned_words`: word PK, created_by, created_at (seeded starter list).
- `chat_strikes`: player_id, reason, created_at (rolling window for auto-ban).
- `game_settings`: `chat:crash:enabled` (bool), `chat:autoban`
  (`{windowMin, strikeThreshold}`).

## Identity

`players.chat_username` - 3-20 chars, `^[A-Za-z0-9_]+$`, case-insensitive
unique, profanity-checked. Set/changed via `POST /chat/username` (auth). Mods
reset it (clears the column; player must pick a new one before chatting).

## Send flow (`chat:send {text}`)

Checks in order: authed -> chat enabled -> has username -> not banned ->
rate limit -> length <=200 -> not profane. On success: persist + broadcast
`chat:message` to the room. Failures return `chat:error {code}` (CHAT_DISABLED,
NO_USERNAME, BANNED, RATE_LIMITED, BLOCKED). A profane message is **blocked**
(not posted) and records a strike; flooding records a strike.

## Auto-ban (escalating & forgiving)

`recordStrike(playerId, reason)` inserts a strike. If strikes in the last
`windowMin` >= `strikeThreshold`, issue an auto-ban whose duration escalates by
the player's prior `system` ban count: 1st -> 1h, 2nd -> 24h, 3rd+ -> permanent
(held for review). Written to `chat_bans` (created_by `system`), reversible by
mods. Thresholds admin-configurable.

## Anti-spam

Per-player in-memory throttle: min ~1.5s between messages; >5 in 10s trips a
spam strike. (Socket events aren't covered by the HTTP rate-limiter.)

## Player UI (Crash page)

`useGameChat('crash')`: on `chat:init` set enabled + history + my username;
handle `chat:message`, `chat:deleted`, `chat:disabled/enabled`, `chat:error`.
`ChatPanel`: scrolling feed + input; set-username inline form when needed;
read-only "Chat paused" when disabled; banned notice when banned.

## Admin - new "Chat" tab (role-gated `support` + `super_admin`, audit-logged)

- `GET /admin/chat/messages?game=crash` - recent (incl. deleted flag).
- `POST /admin/chat/messages/:id/delete` - soft delete + broadcast removal.
- `POST /admin/chat/ban {playerId, durationHours?, reason?}` / `.../unban {playerId}`.
- `GET /admin/chat/banned-words`, `POST` (add), `DELETE` (remove).
- `POST /admin/chat/reset-username {playerId}`.
- `GET/PUT /admin/chat/settings` - enabled toggle (broadcasts) + autoban thresholds.

UI: settings (on/off + thresholds), banned-words editor, recent messages with
delete + ban, active bans with unban, reset-username.

## Safety / PII

Only the chosen username is ever exposed; phone and legal name never leave the
server.

## Testing

`tsc` (api/web/admin); unit tests for username validation, profanity masking,
and strike->auto-ban escalation; end-to-end against prod with a socket.io-client
script using the QA token (set username, send, receive, blocked word, rate
limit, and an admin delete broadcast).

## Out of scope

Other games' chat, socket.io-Redis adapter (horizontal scale), DMs, images,
reactions.
