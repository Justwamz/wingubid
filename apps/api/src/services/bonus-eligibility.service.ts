import { pool } from '@betting/db'
import { getBonusAbuseConfig } from './game-settings.service.js'

export type FlagType = 'prior_bonus' | 'device_bonus' | 'ip_bonus' | 'ip_velocity'

export interface EligibilityFlag {
  type: FlagType
  severity: 'warn' | 'block'
  message: string
  count?: number
  matchedPlayerIds?: string[]
}

const HARD_BLOCK_TYPES = new Set<FlagType>(['prior_bonus', 'device_bonus', 'ip_bonus'])

// A hard block means no self-service bonus may be claimed by this player.
export function isBonusBlocked(flags: EligibilityFlag[]): boolean {
  return flags.some(f => HARD_BLOCK_TYPES.has(f.type) || (f.type === 'ip_velocity' && f.severity === 'block'))
}

// Cross-account duplicate signals for a bonus. Never blocks on its own except an
// (off-by-default) IP-velocity auto-block; the caller decides what to do.
export async function evaluateBonusEligibility(playerId: string): Promise<{ flags: EligibilityFlag[] }> {
  const cfg = await getBonusAbuseConfig()
  const flags: EligibilityFlag[] = []

  const { rows: prior } = await pool.query(
    `SELECT 1 FROM bonus_grants WHERE player_id = $1 LIMIT 1`, [playerId],
  )
  if (prior.length > 0) {
    flags.push({ type: 'prior_bonus', severity: 'warn', message: 'This player has already received a bonus.' })
  }

  // Other accounts on the same device that already received a bonus.
  const { rows: dev } = await pool.query<{ player_id: string }>(
    `SELECT DISTINCT ps.player_id
     FROM player_signals ps
     JOIN bonus_grants bg ON bg.player_id = ps.player_id
     WHERE ps.player_id <> $1
       AND ps.device_id IN (
         SELECT device_id FROM player_signals
         WHERE player_id = $1 AND kind IN ('signup','claim') AND device_id IS NOT NULL)`,
    [playerId],
  )
  if (dev.length > 0) {
    flags.push({ type: 'device_bonus', severity: 'warn', count: dev.length,
      matchedPlayerIds: dev.map(r => r.player_id),
      message: `${dev.length} other account(s) on this device already received a bonus.` })
  }

  // Other accounts on the same signup IP that already received a bonus (household).
  const { rows: ipb } = await pool.query<{ player_id: string }>(
    `SELECT DISTINCT ps.player_id
     FROM player_signals ps
     JOIN bonus_grants bg ON bg.player_id = ps.player_id
     WHERE ps.player_id <> $1
       AND ps.ip IN (
         SELECT ip FROM player_signals
         WHERE player_id = $1 AND kind IN ('signup','claim') AND ip IS NOT NULL)`,
    [playerId],
  )
  if (ipb.length > 0) {
    flags.push({ type: 'ip_bonus', severity: 'warn', count: ipb.length,
      matchedPlayerIds: ipb.map(r => r.player_id),
      message: `${ipb.length} other account(s) on this IP already received a bonus.` })
  }

  // Distinct accounts sharing this player's signup IP(s) (includes this player).
  const { rows: vel } = await pool.query<{ n: string }>(
    `SELECT COUNT(DISTINCT player_id) AS n
     FROM player_signals
     WHERE kind IN ('signup','claim')
       AND ip IN (
         SELECT ip FROM player_signals
         WHERE player_id = $1 AND kind IN ('signup','claim') AND ip IS NOT NULL)`,
    [playerId],
  )
  const n = Number(vel[0].n)
  if (cfg.ipVelocityBlock > 0 && n >= cfg.ipVelocityBlock) {
    flags.push({ type: 'ip_velocity', severity: 'block', count: n,
      message: `${n} accounts share this IP (auto-block threshold reached).` })
  } else if (n >= cfg.ipVelocityFlag) {
    flags.push({ type: 'ip_velocity', severity: 'warn', count: n,
      message: `${n} accounts share this IP.` })
  }

  return { flags }
}
