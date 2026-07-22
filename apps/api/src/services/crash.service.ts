import { pool } from '@betting/db'
import { debitForBet, creditWinnings, debitBonusForBet, settleBonusWin } from './wallet.service.js'
import { assertGameEnabled, getBonusMaxWinCents } from './game-settings.service.js'
import { AppError } from '../lib/errors.js'

export interface PlacedBet {
  betId: string
  effectiveStake: number
}

export async function placeBet(
  playerId: string,
  roundId: string,
  grossStake: number,
  autoCashoutAt: number | undefined,
  fundSource: 'cash' | 'bonus' = 'cash',
): Promise<PlacedBet> {
  await assertGameEnabled('crash')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let walletId: string
    let bonusGrantId: string | null = null
    if (fundSource === 'bonus') {
      const r = await debitBonusForBet(client, playerId, grossStake, { game: 'crash', roundId })
      walletId = r.walletId; bonusGrantId = r.grantId
    } else {
      const r = await debitForBet(client, playerId, grossStake, grossStake, { game: 'crash', roundId })
      walletId = r.walletId
    }
    const { rows } = await client.query<{ id: string; effective_stake: string }>(
      `INSERT INTO bets (player_id, wallet_id, round_id, game_type, gross_stake, wager_tax, effective_stake, auto_cashout_at, fund_source, bonus_grant_id)
       VALUES ($1, $2, $3, 'crash', $4, 0, $5, $6, $7, $8)
       RETURNING id, effective_stake`,
      [playerId, walletId, roundId, grossStake, grossStake, autoCashoutAt ?? null, fundSource, bonusGrantId],
    )
    await client.query('COMMIT')
    return { betId: rows[0].id, effectiveStake: Number(rows[0].effective_stake) }
  } catch (err) {
    await client.query('ROLLBACK')
    // Unique-violation on (player_id, round_id) for crash: a concurrent bet:place
    // for the same round. The rollback undid this duplicate's debit, so surface a
    // clean already-placed error instead of a 500.
    if ((err as { code?: string }).code === '23505') {
      throw new AppError('BET_ALREADY_PLACED', "You've already placed a bet this round.", 409)
    }
    throw err
  } finally {
    client.release()
  }
}

export async function cashout(
  playerId: string,
  betId: string,
  multiplier: number,
  crashPoint: number,
): Promise<{ winnings: number }> {
  // Authoritative fairness guard: never pay at or above the round's crash
  // point. The caller must not settle a bet on a round that has already busted,
  // and we enforce it here rather than trusting the in-memory round status.
  if (!(multiplier < crashPoint)) {
    throw new AppError('ROUND_CRASHED', 'Too late, the round already crashed.', 422)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{
      id: string; effective_stake: string; fund_source: 'cash' | 'bonus'; bonus_grant_id: string | null
    }>(
      `SELECT id, effective_stake, fund_source, bonus_grant_id FROM bets
       WHERE id = $1 AND player_id = $2 AND status = 'active' FOR UPDATE`,
      [betId, playerId],
    )
    if (rows.length === 0) throw new AppError('BET_NOT_FOUND', "We couldn't find an active bet to cash out.", 404)

    const effectiveStake = Number(rows[0].effective_stake)
    const winnings = Math.floor(effectiveStake * multiplier)

    if (rows[0].fund_source === 'bonus') {
      await settleBonusWin(client, playerId, rows[0].bonus_grant_id!, winnings, effectiveStake, betId, await getBonusMaxWinCents())
      // no locked_balance decrement for bonus
    } else {
      await creditWinnings(client, playerId, winnings, { game: 'crash', betId, multiplier })
      await client.query(
        `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
        [effectiveStake, playerId],
      )
    }
    await client.query(
      `UPDATE bets SET status = 'won', cashout_multiplier = $1, winnings = $2, settled_at = NOW() WHERE id = $3`,
      [multiplier, winnings, betId],
    )
    await client.query('COMMIT')
    return { winnings }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function settleLostBets(
  roundId: string,
  serverSeed: string,
  crashPoint: number,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: activeBets } = await client.query<{
      id: string; player_id: string; effective_stake: string; fund_source: 'cash' | 'bonus'
    }>(
      `SELECT id, player_id, effective_stake, fund_source FROM bets WHERE round_id = $1 AND status = 'active'`,
      [roundId],
    )
    if (activeBets.length > 0) {
      const betIds = activeBets.map(b => b.id)
      await client.query(
        `UPDATE bets SET status = 'lost', settled_at = NOW() WHERE id = ANY($1)`,
        [betIds],
      )
      for (const bet of activeBets) {
        // Bonus-funded bets never reserve locked_balance (the stake left
        // bonus_balance outright at debit), so only cash bets release it here.
        if (bet.fund_source === 'cash') {
          await client.query(
            `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
            [Number(bet.effective_stake), bet.player_id],
          )
        }
      }
    }
    await client.query(
      `UPDATE game_rounds
       SET status = 'crashed', server_seed = $1, crash_point = $2, crashed_at = NOW()
       WHERE id = $3`,
      [serverSeed, crashPoint, roundId],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getHouseEdge(key: string): Promise<number> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM game_settings WHERE key = $1`, [key],
  )
  return rows.length === 0 ? 5 : Number(rows[0].value)
}

export async function getRecentRounds(limit = 20): Promise<Array<{
  roundNumber: number; crashPoint: number; createdAt: string
}>> {
  const { rows } = await pool.query(
    `SELECT round_number, crash_point, created_at FROM game_rounds
     WHERE status = 'crashed' ORDER BY round_number DESC LIMIT $1`,
    [limit],
  )
  return rows.map(r => ({
    roundNumber: Number(r.round_number),
    crashPoint: Number(r.crash_point),
    createdAt: r.created_at,
  }))
}
