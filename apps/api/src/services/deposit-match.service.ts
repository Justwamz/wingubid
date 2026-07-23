import { pool } from '@betting/db'
import { grantBonus } from './wallet.service.js'
import { playerMatchesCriteria, type Criteria } from './bonus-criteria.service.js'

// Best-effort: NEVER throws. Grants a deposit-match bonus for the newest active,
// in-window deposit_match campaign the player qualifies for. Runs after a deposit
// has committed, on its own connection.
export async function maybeGrantDepositMatch(playerId: string, depositAmountCents: number): Promise<void> {
  try {
    const { rows: pl } = await pool.query<{ status: string }>(
      `SELECT status FROM players WHERE id = $1`, [playerId],
    )
    if (pl.length === 0 || pl[0].status !== 'active') return

    const { rows: active } = await pool.query(
      `SELECT 1 FROM bonus_grants WHERE player_id = $1 AND status = 'active'`, [playerId],
    )
    if (active.length > 0) return

    const { rows: camps } = await pool.query<{
      id: string; match_percent: number; max_match_cents: string; expiry_days: number; criteria: Criteria | null
    }>(
      `SELECT c.id, c.match_percent, c.max_match_cents, c.expiry_days, c.criteria
       FROM bonus_campaigns c
       WHERE c.reward_kind = 'deposit_match' AND c.status = 'active'
         AND (c.starts_at IS NULL OR c.starts_at <= NOW())
         AND (c.ends_at IS NULL OR c.ends_at >= NOW())
         AND COALESCE(c.min_deposit_cents, 0) <= $2
         AND NOT EXISTS (SELECT 1 FROM bonus_claims bc WHERE bc.campaign_id = c.id AND bc.player_id = $1)
       ORDER BY c.created_at DESC`,
      [playerId, depositAmountCents],
    )

    let chosen: (typeof camps)[number] | null = null
    for (const c of camps) {
      if (c.criteria && !(await playerMatchesCriteria(playerId, c.criteria))) continue
      chosen = c
      break
    }
    if (!chosen) return

    const bonus = Math.min(
      Math.floor((depositAmountCents * chosen.match_percent) / 100),
      Number(chosen.max_match_cents),
    )
    if (bonus <= 0) return

    const expiresAt = new Date(Date.now() + chosen.expiry_days * 24 * 60 * 60 * 1000)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { grantId } = await grantBonus(client, playerId, bonus, null, expiresAt, { source: 'campaign', campaignId: chosen.id })
      await client.query(
        `INSERT INTO bonus_claims (campaign_id, player_id, grant_id) VALUES ($1, $2, $3)`,
        [chosen.id, playerId, grantId],
      )
      await client.query('COMMIT')
      client.release()
    } catch (err) {
      try {
        await client.query('ROLLBACK')
        client.release()
      } catch (rollbackErr) {
        // ROLLBACK failed: the connection may be poisoned. Destroy it (release
        // with an error) instead of returning it to the pool.
        client.release(rollbackErr as Error)
      }
      // 23505 = already matched (race with the one-active/one-per-campaign guards)
      if ((err as { code?: string }).code !== '23505') throw err
    }
  } catch (err) {
    // Best-effort: a deposit must never fail because of the bonus match.
    console.warn('[deposit-match] skipped:', (err as Error)?.message)
  }
}
