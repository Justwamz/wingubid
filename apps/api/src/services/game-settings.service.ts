import { pool } from '@betting/db'
import { AppError } from '../lib/errors.js'

export type GameKey = 'crash' | 'mines' | 'dice'

export type AnyGame = 'crash' | 'mines' | 'dice' | 'scratch' | 'lottery'
export const ALL_GAMES: AnyGame[] = ['crash', 'mines', 'dice', 'scratch', 'lottery']

const EDGE_KEY: Record<GameKey, string> = {
  crash: 'crash_house_edge',
  mines: 'mines_house_edge',
  dice: 'dice_house_edge',
}

const DEFAULT_EDGE = 5

// Read the configured house edge (%) for each game, falling back to the default
// when a key is missing.
export async function getHouseEdges(): Promise<Record<GameKey, number>> {
  const { rows } = await pool.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM game_settings
     WHERE key IN ('crash_house_edge', 'mines_house_edge', 'dice_house_edge')`,
  )
  const byKey = new Map(rows.map(r => [r.key, Number(r.value)]))
  return {
    crash: byKey.get(EDGE_KEY.crash) ?? DEFAULT_EDGE,
    mines: byKey.get(EDGE_KEY.mines) ?? DEFAULT_EDGE,
    dice: byKey.get(EDGE_KEY.dice) ?? DEFAULT_EDGE,
  }
}

// Upsert the house edge (%) for a single game.
export async function setHouseEdge(game: GameKey, edge: number): Promise<void> {
  await pool.query(
    `INSERT INTO game_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [EDGE_KEY[game], JSON.stringify(edge)],
  )
}

const WITHDRAWAL_THRESHOLD_KEY = 'withdrawal_approval_threshold'
const DEFAULT_WITHDRAWAL_THRESHOLD = 100000 // cents = KES 1,000

// Withdrawals strictly above this (cents) require an admin approval.
export async function getWithdrawalThreshold(): Promise<number> {
  const { rows } = await pool.query<{ value: unknown }>(
    `SELECT value FROM game_settings WHERE key = $1`, [WITHDRAWAL_THRESHOLD_KEY],
  )
  return rows.length ? Number(rows[0].value) : DEFAULT_WITHDRAWAL_THRESHOLD
}

export async function setWithdrawalThreshold(cents: number): Promise<void> {
  await pool.query(
    `INSERT INTO game_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [WITHDRAWAL_THRESHOLD_KEY, JSON.stringify(cents)],
  )
}

// ---- Per-game availability (manual pause) ----------------------------------

const enabledKey = (g: AnyGame) => `${g}_enabled`
let enabledCache: { map: Record<AnyGame, boolean>; at: number } | null = null
const ENABLED_TTL = 15_000

export async function getGamesEnabled(): Promise<Record<AnyGame, boolean>> {
  if (enabledCache && Date.now() - enabledCache.at < ENABLED_TTL) return enabledCache.map
  const { rows } = await pool.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM game_settings WHERE key IN ('crash_enabled','mines_enabled','dice_enabled','scratch_enabled','lottery_enabled')`,
  )
  const byKey = new Map(rows.map(r => [r.key, Boolean(r.value)]))
  const map = Object.fromEntries(ALL_GAMES.map(g => [g, byKey.get(enabledKey(g)) ?? true])) as Record<AnyGame, boolean>
  enabledCache = { map, at: Date.now() }
  return map
}

export async function setGameEnabled(game: AnyGame, enabled: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO game_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [enabledKey(game), JSON.stringify(enabled)],
  )
  enabledCache = null
}

// Throws GAME_DISABLED when a game is paused. Call at each bet entry point.
export async function assertGameEnabled(game: AnyGame): Promise<void> {
  const map = await getGamesEnabled()
  if (!map[game]) {
    throw new AppError('GAME_DISABLED', 'This game is temporarily unavailable. Please try again later.', 423)
  }
}

// ---- RTP monitor config ----------------------------------------------------

export interface RtpMonitorConfig {
  windowMinutes: number
  minBets: number
  reAlertMinutes: number
  warnRtp: Record<'crash' | 'mines' | 'dice' | 'scratch', number>
}

const DEFAULT_RTP_CONFIG: RtpMonitorConfig = {
  windowMinutes: 60, minBets: 200, reAlertMinutes: 60,
  warnRtp: { crash: 1.02, mines: 1.02, dice: 1.02, scratch: 0.90 },
}

export async function getRtpMonitorConfig(): Promise<RtpMonitorConfig> {
  const { rows } = await pool.query<{ value: Partial<RtpMonitorConfig> }>(`SELECT value FROM game_settings WHERE key = 'rtp_monitor'`)
  const v = rows[0]?.value ?? {}
  return {
    windowMinutes: v.windowMinutes ?? DEFAULT_RTP_CONFIG.windowMinutes,
    minBets: v.minBets ?? DEFAULT_RTP_CONFIG.minBets,
    reAlertMinutes: v.reAlertMinutes ?? DEFAULT_RTP_CONFIG.reAlertMinutes,
    warnRtp: { ...DEFAULT_RTP_CONFIG.warnRtp, ...(v.warnRtp ?? {}) },
  }
}

export async function setRtpMonitorConfig(cfg: RtpMonitorConfig): Promise<void> {
  await pool.query(
    `INSERT INTO game_settings (key, value, updated_at)
     VALUES ('rtp_monitor', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(cfg)],
  )
}

// ---- Game-ordering config --------------------------------------------------

export interface GameOrderConfig {
  windowDays: number
  revenueWeight: number // 0..1; activity weight is (1 - revenueWeight)
  minStake: number      // cents; minimum window volume to be ranked
}

const DEFAULT_ORDER_CONFIG: GameOrderConfig = { windowDays: 7, revenueWeight: 0.7, minStake: 100000 }

export async function getGameOrderConfig(): Promise<GameOrderConfig> {
  const { rows } = await pool.query<{ value: Partial<GameOrderConfig> }>(`SELECT value FROM game_settings WHERE key = 'game_order'`)
  const v = rows[0]?.value ?? {}
  return {
    windowDays: v.windowDays ?? DEFAULT_ORDER_CONFIG.windowDays,
    revenueWeight: v.revenueWeight ?? DEFAULT_ORDER_CONFIG.revenueWeight,
    minStake: v.minStake ?? DEFAULT_ORDER_CONFIG.minStake,
  }
}

export async function setGameOrderConfig(cfg: GameOrderConfig): Promise<void> {
  await pool.query(
    `INSERT INTO game_settings (key, value, updated_at)
     VALUES ('game_order', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(cfg)],
  )
}
