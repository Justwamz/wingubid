import { pool } from '@betting/db'
import { debitForBet, creditWinnings } from './wallet.service.js'
import { rollDiceResult } from '../lib/crash-rng.js'
import { getHouseEdge } from './crash.service.js'
import { assertGameEnabled } from './game-settings.service.js'
import { nextDiceRoll } from './dice-seed.service.js'

export async function rollDice(
  playerId: string,
  grossStake: number,
  target: number,
  direction: 'over' | 'under',
): Promise<{
  result: number; won: boolean; multiplier: number; winnings: number
  serverSeedHash: string; clientSeed: string; nonce: number
}> {
  await assertGameEnabled('dice')
  const houseEdge = await getHouseEdge('dice_house_edge')

  const winCount = direction === 'over' ? 100 - target : target
  const multiplier = Math.floor(((100 - houseEdge) / winCount) * 100) / 100

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Provably fair: the server seed's hash was committed before this roll and
    // is only revealed on rotation; the nonce is claimed atomically per roll.
    const { serverSeed, serverSeedHash, clientSeed, nonce } = await nextDiceRoll(client, playerId)
    const result = rollDiceResult(serverSeed, clientSeed, nonce)
    const won = direction === 'over' ? result >= target : result < target
    const winnings = won ? Math.floor(grossStake * multiplier) : 0

    // Dice settles in this same transaction, so don't reserve locked_balance
    // (nothing would release it later).
    const { walletId } = await debitForBet(client, playerId, grossStake, grossStake, {
      game: 'dice', result, target, direction,
    }, { lock: false })

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO bets (player_id, wallet_id, game_type, gross_stake, wager_tax, effective_stake,
        cashout_multiplier, winnings, status, settled_at)
       VALUES ($1, $2, 'dice', $3, 0, $4, $5, $6, $7, NOW()) RETURNING id`,
      [playerId, walletId, grossStake, grossStake, multiplier, winnings, won ? 'won' : 'lost'],
    )

    if (won) {
      await creditWinnings(client, playerId, winnings, { game: 'dice', betId: rows[0].id })
    }

    await client.query('COMMIT')
    return { result, won, multiplier, winnings, serverSeedHash, clientSeed, nonce }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
