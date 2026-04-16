import { randomBytes } from 'crypto'
import { pool } from '@betting/db'
import { debitForBet, creditWinnings } from './wallet.service.js'
import { rollDiceResult } from '../lib/crash-rng.js'
import { getHouseEdge } from './crash.service.js'

export async function rollDice(
  playerId: string,
  grossStake: number,
  target: number,
  direction: 'over' | 'under',
): Promise<{
  result: number; won: boolean; multiplier: number; winnings: number
  serverSeed: string; clientSeed: string; nonce: number
}> {
  const serverSeed = randomBytes(32).toString('hex')
  const clientSeed = randomBytes(16).toString('hex')
  const houseEdge = await getHouseEdge('dice_house_edge')

  const winCount = direction === 'over' ? 100 - target : target
  const multiplier = Math.floor(((100 - houseEdge) / winCount) * 100) / 100

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: nonceRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM bets WHERE player_id = $1 AND game_type = 'dice'`,
      [playerId],
    )
    const nonce = Number(nonceRows[0].count)
    const result = rollDiceResult(serverSeed, clientSeed, nonce)
    const won = direction === 'over' ? result >= target : result < target
    const winnings = won ? Math.floor(grossStake * multiplier) : 0

    const { walletId } = await debitForBet(client, playerId, grossStake, grossStake, {
      game: 'dice', result, target, direction,
    })

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO bets (player_id, wallet_id, game_type, gross_stake, wager_tax, effective_stake,
        cashout_multiplier, winnings, status, settled_at)
       VALUES ($1, $2, 'dice', $3, 0, $4, $5, $6, $7, NOW()) RETURNING id`,
      [playerId, walletId, grossStake, grossStake, multiplier, winnings, won ? 'won' : 'lost'],
    )

    if (won) {
      await creditWinnings(client, playerId, winnings, { game: 'dice', betId: rows[0].id })
    }

    await client.query(
      `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
      [grossStake, playerId],
    )

    await client.query('COMMIT')
    return { result, won, multiplier, winnings, serverSeed, clientSeed, nonce }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
