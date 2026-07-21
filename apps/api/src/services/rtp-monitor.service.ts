import { pool } from '@betting/db'
import { getRtpMonitorConfig } from './game-settings.service.js'
import { notifyRtpAlert } from './email.service.js'

export const MONITORED_GAMES = ['crash', 'mines', 'dice', 'scratch'] as const
export type MonitoredGame = typeof MONITORED_GAMES[number]

export interface RtpStat { rtp: number | null; nBets: number; staked: number; paid: number }

// Realized RTP (payouts / stakes) per monitored game over a rolling window.
// bets (crash/mines/dice) windowed on settled_at; scratch on created_at.
export async function computeRealizedRtp(windowMinutes: number): Promise<Record<MonitoredGame, RtpStat>> {
  const out = Object.fromEntries(
    MONITORED_GAMES.map(g => [g, { rtp: null, nBets: 0, staked: 0, paid: 0 } as RtpStat]),
  ) as Record<MonitoredGame, RtpStat>

  const { rows: bets } = await pool.query<{ game_type: string; paid: string; staked: string; n: string }>(
    `SELECT game_type, SUM(COALESCE(winnings, 0)) AS paid, SUM(gross_stake) AS staked, COUNT(*) AS n
     FROM bets
     WHERE status IN ('won', 'lost')
       AND game_type IN ('crash', 'mines', 'dice')
       AND settled_at >= NOW() - ($1 || ' minutes')::interval
     GROUP BY game_type`,
    [String(windowMinutes)],
  )
  for (const r of bets) {
    const g = r.game_type as MonitoredGame
    const staked = Number(r.staked), paid = Number(r.paid)
    out[g] = { staked, paid, nBets: Number(r.n), rtp: staked > 0 ? paid / staked : null }
  }

  const { rows: sc } = await pool.query<{ paid: string | null; staked: string | null; n: string }>(
    `SELECT SUM(prize_cents) AS paid, SUM(stake_cents) AS staked, COUNT(*) AS n
     FROM scratch_cards WHERE created_at >= NOW() - ($1 || ' minutes')::interval`,
    [String(windowMinutes)],
  )
  const s = sc[0]
  const sStaked = Number(s?.staked ?? 0), sPaid = Number(s?.paid ?? 0)
  out.scratch = { staked: sStaked, paid: sPaid, nBets: Number(s?.n ?? 0), rtp: sStaked > 0 ? sPaid / sStaked : null }

  return out
}

// In-memory last-alert times (reset on deploy - acceptable for throttling).
const lastAlert = new Map<MonitoredGame, number>()

// Warn-only: email the risk address for any monitored game whose RTP exceeds its
// warn threshold, given enough sample, throttled per game. Never auto-disables.
export async function runRtpMonitor(): Promise<void> {
  const cfg = await getRtpMonitorConfig()
  const stats = await computeRealizedRtp(cfg.windowMinutes)
  const now = Date.now()

  for (const g of MONITORED_GAMES) {
    const s = stats[g]
    if (s.rtp == null || s.nBets < cfg.minBets) continue
    if (s.rtp <= cfg.warnRtp[g]) continue
    if (now - (lastAlert.get(g) ?? 0) < cfg.reAlertMinutes * 60_000) continue
    lastAlert.set(g, now)
    await notifyRtpAlert(g, s.rtp, s.nBets, cfg.windowMinutes)
  }
}
