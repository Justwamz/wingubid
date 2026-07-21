import { pool } from '@betting/db'
import { AppError } from '../lib/errors.js'

// ---- Pure helpers (unit-tested) --------------------------------------------

export function validateUsernameFormat(username: string): string | null {
  if (username.length < 3 || username.length > 20) return 'Username must be 3-20 characters.'
  if (!/^[A-Za-z0-9_]+$/.test(username)) return 'Use only letters, numbers, and underscore.'
  return null
}

// Token-based profanity match against the dictionary (case-insensitive), so
// "assassin" doesn't trip on "ass" but "you suck fool" catches "fool".
export function hasProfanity(text: string, words: string[]): boolean {
  if (words.length === 0) return false
  const set = new Set(words.map(w => w.toLowerCase()))
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).some(t => set.has(t))
}

// ---- Banned words (cached hot path) ----------------------------------------

let wordCache: { words: string[]; at: number } | null = null
const WORD_TTL = 30_000

export async function getBannedWords(): Promise<string[]> {
  if (wordCache && Date.now() - wordCache.at < WORD_TTL) return wordCache.words
  const { rows } = await pool.query<{ word: string }>(`SELECT word FROM chat_banned_words`)
  const words = rows.map(r => r.word)
  wordCache = { words, at: Date.now() }
  return words
}

export async function listBannedWords(): Promise<string[]> {
  const { rows } = await pool.query<{ word: string }>(`SELECT word FROM chat_banned_words ORDER BY word`)
  return rows.map(r => r.word)
}

export async function addBannedWord(word: string, by: string): Promise<void> {
  const w = word.trim().toLowerCase()
  if (!w) throw new AppError('VALIDATION_ERROR', 'Word cannot be empty.', 400)
  await pool.query(`INSERT INTO chat_banned_words (word, created_by) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [w, by])
  wordCache = null
}

export async function removeBannedWord(word: string): Promise<void> {
  await pool.query(`DELETE FROM chat_banned_words WHERE word = $1`, [word.trim().toLowerCase()])
  wordCache = null
}

// ---- Username --------------------------------------------------------------

export async function getUsername(playerId: string): Promise<string | null> {
  const { rows } = await pool.query<{ chat_username: string | null }>(
    `SELECT chat_username FROM players WHERE id = $1`, [playerId],
  )
  return rows[0]?.chat_username ?? null
}

export async function setUsername(playerId: string, username: string): Promise<string> {
  const trimmed = username.trim()
  const formatErr = validateUsernameFormat(trimmed)
  if (formatErr) throw new AppError('VALIDATION_ERROR', formatErr, 400)
  if (hasProfanity(trimmed, await getBannedWords())) {
    throw new AppError('VALIDATION_ERROR', 'That username is not allowed.', 400)
  }
  const { rows: taken } = await pool.query(
    `SELECT 1 FROM players WHERE LOWER(chat_username) = LOWER($1) AND id <> $2`, [trimmed, playerId],
  )
  if (taken.length > 0) throw new AppError('USERNAME_TAKEN', 'That username is already taken.', 409)
  await pool.query(`UPDATE players SET chat_username = $1 WHERE id = $2`, [trimmed, playerId])
  return trimmed
}

export async function resetUsername(playerId: string): Promise<void> {
  await pool.query(`UPDATE players SET chat_username = NULL WHERE id = $1`, [playerId])
}

// ---- Messages --------------------------------------------------------------

export interface ChatMessage {
  id: string; username: string; text: string; createdAt: string
}

export async function getRecentMessages(game: string, limit = 50): Promise<ChatMessage[]> {
  const { rows } = await pool.query<{ id: string; username: string; text: string; created_at: string }>(
    `SELECT id, username, text, created_at FROM chat_messages
     WHERE game = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT $2`,
    [game, limit],
  )
  return rows.reverse().map(r => ({ id: r.id, username: r.username, text: r.text, createdAt: r.created_at }))
}

export async function saveMessage(game: string, playerId: string, username: string, text: string): Promise<ChatMessage> {
  const { rows } = await pool.query<{ id: string; created_at: string }>(
    `INSERT INTO chat_messages (game, player_id, username, text) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
    [game, playerId, username, text],
  )
  return { id: rows[0].id, username, text, createdAt: rows[0].created_at }
}

// Soft-delete; returns the game so the caller can broadcast to the right room.
export async function deleteMessage(id: string, adminId: string): Promise<string | null> {
  const { rows } = await pool.query<{ game: string }>(
    `UPDATE chat_messages SET deleted_at = NOW(), deleted_by = $2
     WHERE id = $1 AND deleted_at IS NULL RETURNING game`,
    [id, adminId],
  )
  return rows[0]?.game ?? null
}

export async function getMessagesForAdmin(game: string, limit = 100): Promise<Array<{
  id: string; playerId: string; username: string; text: string; createdAt: string; deleted: boolean
}>> {
  const { rows } = await pool.query<{
    id: string; player_id: string; username: string; text: string; created_at: string; deleted_at: string | null
  }>(
    `SELECT id, player_id, username, text, created_at, deleted_at FROM chat_messages
     WHERE game = $1 ORDER BY created_at DESC LIMIT $2`,
    [game, limit],
  )
  return rows.map(r => ({
    id: r.id, playerId: r.player_id, username: r.username, text: r.text,
    createdAt: r.created_at, deleted: r.deleted_at != null,
  }))
}

// ---- Bans ------------------------------------------------------------------

export interface ActiveBan { until: string | null; reason: string | null }

export async function getActiveBan(playerId: string): Promise<ActiveBan | null> {
  const { rows } = await pool.query<{ until: string | null; reason: string | null }>(
    `SELECT until, reason FROM chat_bans
     WHERE player_id = $1 AND (until IS NULL OR until > NOW())
     ORDER BY created_at DESC LIMIT 1`,
    [playerId],
  )
  return rows[0] ?? null
}

export async function banPlayer(playerId: string, until: Date | null, reason: string, by: string): Promise<void> {
  await pool.query(
    `INSERT INTO chat_bans (player_id, until, reason, created_by) VALUES ($1, $2, $3, $4)`,
    [playerId, until, reason, by],
  )
}

export async function unbanPlayer(playerId: string): Promise<void> {
  await pool.query(
    `UPDATE chat_bans SET until = NOW() WHERE player_id = $1 AND (until IS NULL OR until > NOW())`,
    [playerId],
  )
}

export async function listActiveBans(): Promise<Array<{
  playerId: string; username: string | null; until: string | null; reason: string | null; createdBy: string; createdAt: string
}>> {
  const { rows } = await pool.query<{
    player_id: string; chat_username: string | null; until: string | null; reason: string | null; created_by: string; created_at: string
  }>(
    `SELECT DISTINCT ON (b.player_id) b.player_id, p.chat_username, b.until, b.reason, b.created_by, b.created_at
     FROM chat_bans b JOIN players p ON p.id = b.player_id
     WHERE b.until IS NULL OR b.until > NOW()
     ORDER BY b.player_id, b.created_at DESC`,
  )
  return rows.map(r => ({
    playerId: r.player_id, username: r.chat_username, until: r.until,
    reason: r.reason, createdBy: r.created_by, createdAt: r.created_at,
  }))
}

// ---- Strikes / auto-ban ----------------------------------------------------

interface AutobanConfig { windowMin: number; strikeThreshold: number }

export async function getAutobanConfig(): Promise<AutobanConfig> {
  const { rows } = await pool.query<{ value: AutobanConfig }>(`SELECT value FROM game_settings WHERE key = 'chat:autoban'`)
  const v = rows[0]?.value
  return { windowMin: v?.windowMin ?? 10, strikeThreshold: v?.strikeThreshold ?? 3 }
}

export async function setAutobanConfig(cfg: AutobanConfig): Promise<void> {
  await pool.query(
    `INSERT INTO game_settings (key, value, updated_at) VALUES ('chat:autoban', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(cfg)],
  )
}

// Records a strike and, if the rolling threshold is crossed, issues an
// escalating auto-ban (1h -> 24h -> permanent by prior system-ban count).
export async function recordStrike(playerId: string, reason: string): Promise<{ banned: boolean; until: Date | null }> {
  await pool.query(`INSERT INTO chat_strikes (player_id, reason) VALUES ($1, $2)`, [playerId, reason])
  const cfg = await getAutobanConfig()
  const { rows: cnt } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM chat_strikes WHERE player_id = $1 AND created_at > NOW() - ($2 || ' minutes')::interval`,
    [playerId, String(cfg.windowMin)],
  )
  if (Number(cnt[0].n) < cfg.strikeThreshold) return { banned: false, until: null }

  const { rows: prior } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM chat_bans WHERE player_id = $1 AND created_by = 'system'`, [playerId],
  )
  const priorBans = Number(prior[0].n)
  let until: Date | null
  if (priorBans === 0) until = new Date(Date.now() + 60 * 60 * 1000)         // 1h
  else if (priorBans === 1) until = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
  else until = null                                                            // permanent
  await banPlayer(playerId, until, `auto: ${reason}`, 'system')
  return { banned: true, until }
}

// ---- Enabled / kill-switch -------------------------------------------------

export async function getChatEnabled(game: string): Promise<boolean> {
  const { rows } = await pool.query<{ value: unknown }>(`SELECT value FROM game_settings WHERE key = $1`, [`chat:${game}:enabled`])
  return rows.length ? Boolean(rows[0].value) : true
}

export async function setChatEnabled(game: string, enabled: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO game_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [`chat:${game}:enabled`, JSON.stringify(enabled)],
  )
}
