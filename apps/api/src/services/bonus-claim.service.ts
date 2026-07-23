import net from 'net'
import { pool } from '@betting/db'
import { AppError } from '../lib/errors.js'
import { grantBonus } from './wallet.service.js'
import { evaluateBonusEligibility, isBonusBlocked } from './bonus-eligibility.service.js'
import { playerMatchesCriteria, type Criteria } from './bonus-criteria.service.js'

export async function resolveCampaignByCode(code: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM bonus_campaigns WHERE code = $1`, [code.trim().toUpperCase()],
  )
  return rows.length ? rows[0].id : null
}

// Self-service claim of a campaign bonus. Strict abuse enforcement (no admin to
// review): hard-signal flags block the claim. Best-effort claim-signal capture.
export async function claimCampaignBonus(
  playerId: string,
  campaignId: string,
  ip: string | undefined,
  deviceId: string | undefined,
  code?: string,
): Promise<{ amountCents: number }> {
  // Responsible-gambling gate: suspended/self-excluded players can never be
  // lured with a bonus. Checked first, before any campaign/claim logic.
  const { rows: playerRows } = await pool.query<{ status: string }>(
    `SELECT status FROM players WHERE id = $1`, [playerId],
  )
  if (playerRows.length === 0 || playerRows[0].status !== 'active') {
    throw new AppError('NOT_ELIGIBLE', "You're not eligible for this bonus.", 422)
  }

  const { rows: camp } = await pool.query<{
    amount_cents: string; expiry_days: number; status: string
    starts_at: string | null; ends_at: string | null
    code: string | null; criteria: Criteria | null; reward_kind: string
  }>(
    `SELECT amount_cents, expiry_days, status, starts_at, ends_at, code, criteria, reward_kind
     FROM bonus_campaigns WHERE id = $1`,
    [campaignId],
  )
  if (camp.length === 0) throw new AppError('CAMPAIGN_UNAVAILABLE', 'This bonus is not available.', 422)
  const c = camp[0]
  const now = Date.now()
  const notStarted = c.starts_at && new Date(c.starts_at).getTime() > now
  const ended = c.ends_at && new Date(c.ends_at).getTime() < now
  if (c.status !== 'active' || notStarted || ended) {
    throw new AppError('CAMPAIGN_UNAVAILABLE', 'This bonus is not available.', 422)
  }
  // Deposit-match bonuses are granted automatically on a qualifying deposit;
  // they can never be manually claimed.
  if (c.reward_kind === 'deposit_match') {
    throw new AppError('CAMPAIGN_UNAVAILABLE', 'This bonus is not available.', 422)
  }

  // Promo code gate.
  if (c.code) {
    if (!code || code.trim().toUpperCase() !== c.code.toUpperCase()) {
      throw new AppError('INVALID_CODE', 'That promo code is not valid.', 422)
    }
  }
  // Audience targeting gate (generic message; no criteria detail leaked).
  if (c.criteria && !(await playerMatchesCriteria(playerId, c.criteria))) {
    throw new AppError('NOT_ELIGIBLE', "You're not eligible for this bonus.", 422)
  }

  const { rows: claimed } = await pool.query(
    `SELECT 1 FROM bonus_claims WHERE campaign_id = $1 AND player_id = $2`, [campaignId, playerId],
  )
  if (claimed.length > 0) throw new AppError('ALREADY_CLAIMED', "You've already claimed this bonus.", 422)

  const { rows: active } = await pool.query(
    `SELECT 1 FROM bonus_grants WHERE player_id = $1 AND status = 'active'`, [playerId],
  )
  if (active.length > 0) throw new AppError('ACTIVE_BONUS_EXISTS', 'Finish your current bonus before claiming another.', 422)

  // Best-effort claim signal (validated IP), before eligibility so it counts.
  const sigIp = ip && net.isIP(ip) ? ip : null
  if (sigIp || deviceId) {
    try {
      await pool.query(
        `INSERT INTO player_signals (player_id, kind, ip, device_id) VALUES ($1, 'claim', $2, $3)`,
        [playerId, sigIp, deviceId ? deviceId.slice(0, 64) : null],
      )
    } catch { /* non-critical */ }
  }

  const { flags } = await evaluateBonusEligibility(playerId)
  if (isBonusBlocked(flags)) {
    throw new AppError('NOT_ELIGIBLE', "You're not eligible for this bonus.", 422)
  }

  const amount = Number(c.amount_cents)
  const expiresAt = new Date(now + c.expiry_days * 24 * 60 * 60 * 1000)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { grantId } = await grantBonus(client, playerId, amount, null, expiresAt, { source: 'campaign', campaignId })
    await client.query(
      `INSERT INTO bonus_claims (campaign_id, player_id, grant_id) VALUES ($1, $2, $3)`,
      [campaignId, playerId, grantId],
    )
    await client.query('COMMIT')
    return { amountCents: amount }
  } catch (err) {
    await client.query('ROLLBACK')
    if ((err as { code?: string }).code === '23505') {
      throw new AppError('ALREADY_CLAIMED', "You've already claimed this bonus.", 422)
    }
    throw err
  } finally {
    client.release()
  }
}
