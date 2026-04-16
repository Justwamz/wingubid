import { pool } from '@betting/db'
import { debitForBet, creditWinnings } from './wallet.service.js'
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
): Promise<PlacedBet> {
  const client = await pool.connect()
  try {
    const { walletId } = await debitForBet(client, playerId, grossStake, grossStake, {
      game: 'crash', roundId,
    })
    const { rows } = await client.query<{ id: string; effective_stake: string }>(
      `INSERT INTO bets (player_id, wallet_id, round_id, game_type, gross_stake, wager_tax, effective_stake, auto_cashout_at)
       VALUES ($1, $2, $3, 'crash', $4, 0, $5, $6)
       RETURNING id, effective_stake`,
      [playerId, walletId, roundId, grossStake, grossStake, autoCashoutAt ?? null],
    )
    return { betId: rows[0].id, effectiveStake: Number(rows[0].effective_stake) }
  } finally {
    client.release()
  }
}

export async function cashout(
  playerId: string,
  betId: string,
  multiplier: number,
): Promise<{ winnings: number }> {
  const client = await pool.connect()
  try {
    const { rows } = await client.query<{ id: string; effective_stake: string }>(
      `SELECT id, effective_stake FROM bets
       WHERE id = $1 AND player_id = $2 AND status = 'active' FOR UPDATE`,
      [betId, playerId],
    )
    if (rows.length === 0) throw new AppError('BET_NOT_FOUND', 'Active bet not found', 404)

    const effectiveStake = Number(rows[0].effective_stake)
    const winnings = Math.floor(effectiveStake * multiplier)

    await creditWinnings(client, playerId, winnings, { game: 'crash', betId, multiplier })
    await client.query(
      `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
      [effectiveStake, playerId],
    )
    await client.query(
      `UPDATE bets SET status = 'won', cashout_multiplier = $1, winnings = $2, settled_at = NOW() WHERE id = $3`,
      [multiplier, winnings, betId],
    )
    return { winnings }
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
    const { rows: activeBets } = await client.query<{
      id: string; player_id: string; effective_stake: string
    }>(
      `SELECT id, player_id, effective_stake FROM bets WHERE round_id = $1 AND status = 'active'`,
      [roundId],
    )
    if (activeBets.length > 0) {
      const betIds = activeBets.map(b => b.id)
      await client.query(
        `UPDATE bets SET status = 'lost', settled_at = NOW() WHERE id = ANY($1)`,
        [betIds],
      )
      for (const bet of activeBets) {
        await client.query(
          `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
          [Number(bet.effective_stake), bet.player_id],
        )
      }
    }
    await client.query(
      `UPDATE game_rounds
       SET status = 'crashed', server_seed = $1, crash_point = $2, crashed_at = NOW()
       WHERE id = $3`,
      [serverSeed, crashPoint, roundId],
    )
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
