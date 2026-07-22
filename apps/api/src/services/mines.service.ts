import { randomBytes, createHash } from 'crypto'
import { pool } from '@betting/db'
import { getRedis } from '../lib/redis.js'
import { debitForBet, creditWinnings, debitBonusForBet, settleBonusWin } from './wallet.service.js'
import { generateMinePositions } from '../lib/crash-rng.js'
import { getHouseEdge } from './crash.service.js'
import { assertGameEnabled, getBonusMaxWinCents } from './game-settings.service.js'
import { AppError } from '../lib/errors.js'

const GAME_TTL = 1800

interface MinesGameState {
  gameId: string; playerId: string; gridSize: number; mineCount: number
  minePositions: number[]; serverSeed: string; serverSeedHash: string
  clientSeed: string; revealedTiles: number[]; effectiveStake: number
  currentMultiplier: number; status: 'active' | 'won' | 'lost'; betId: string
}

const redisKey = (playerId: string) => `mines:player:${playerId}`

function nextMultiplier(cur: number, safe: number, total: number, revealed: number): number {
  const pSafe = (safe - revealed) / (total - revealed)
  return Math.floor((cur / pSafe) * 100) / 100
}

// A successful reveal must never be worth less than the stake. On very-low-mine
// grids the fair-times-edge multiplier after the first reveal can dip just below
// 1.0 (e.g. 25 tiles / 1 mine -> ~0.99); floor the paid/displayed value at 1.0
// so a win is never a loss. The raw progression value is kept for the curve.
function payoutMultiplier(m: number): number {
  return Math.max(1.0, m)
}

export async function startGame(
  playerId: string, grossStake: number, gridSize: number, mineCount: number,
  fundSource: 'cash' | 'bonus' = 'cash',
): Promise<{ gameId: string; serverSeedHash: string; clientSeed: string; gridSize: number; mineCount: number }> {
  await assertGameEnabled('mines')
  const redis = getRedis()
  const existing = await redis.get(redisKey(playerId))
  if (existing && (JSON.parse(existing) as MinesGameState).status === 'active') {
    throw new AppError('GAME_ALREADY_ACTIVE', 'You already have a mines game in progress. Please finish it first.', 422)
  }

  const totalTiles = gridSize * gridSize
  if (mineCount < 1 || mineCount >= totalTiles) {
    throw new AppError('INVALID_MINE_COUNT', 'Please choose a valid number of mines for the grid.', 400)
  }

  const serverSeed = randomBytes(32).toString('hex')
  const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex')
  const clientSeed = randomBytes(16).toString('hex')
  const gameId = randomBytes(16).toString('hex')
  const houseEdge = await getHouseEdge('mines_house_edge')
  const minePositions = generateMinePositions(serverSeed, clientSeed, gameId, totalTiles, mineCount)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let walletId: string
    let bonusGrantId: string | null = null
    if (fundSource === 'bonus') {
      const r = await debitBonusForBet(client, playerId, grossStake, { game: 'mines', gameId })
      walletId = r.walletId; bonusGrantId = r.grantId
    } else {
      const r = await debitForBet(client, playerId, grossStake, grossStake, { game: 'mines', gameId })
      walletId = r.walletId
    }
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO bets (player_id, wallet_id, game_type, gross_stake, wager_tax, effective_stake, fund_source, bonus_grant_id)
       VALUES ($1, $2, 'mines', $3, 0, $4, $5, $6) RETURNING id`,
      [playerId, walletId, grossStake, grossStake, fundSource, bonusGrantId],
    )
    await client.query('COMMIT')

    const state: MinesGameState = {
      gameId, playerId, gridSize, mineCount, minePositions,
      serverSeed, serverSeedHash, clientSeed, revealedTiles: [],
      effectiveStake: grossStake, currentMultiplier: 1 - houseEdge / 100,
      status: 'active', betId: rows[0].id,
    }
    await redis.setex(redisKey(playerId), GAME_TTL, JSON.stringify(state))
    return { gameId, serverSeedHash, clientSeed, gridSize, mineCount }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Returns the player's in-progress game so the client can resume it after a
// reload / navigation. Deliberately omits minePositions and the serverSeed so
// resuming can't be used to cheat. Returns null when there is no active game.
export async function getCurrentGame(playerId: string): Promise<{
  gameId: string; gridSize: number; mineCount: number; serverSeedHash: string
  clientSeed: string; revealedTiles: number[]; multiplier: number; status: 'active'
} | null> {
  const redis = getRedis()
  const raw = await redis.get(redisKey(playerId))
  if (!raw) return null
  const state = JSON.parse(raw) as MinesGameState
  if (state.status !== 'active') return null
  return {
    gameId: state.gameId,
    gridSize: state.gridSize,
    mineCount: state.mineCount,
    serverSeedHash: state.serverSeedHash,
    clientSeed: state.clientSeed,
    revealedTiles: state.revealedTiles,
    multiplier: payoutMultiplier(state.currentMultiplier),
    status: 'active',
  }
}

export async function revealTile(
  playerId: string, gameId: string, tileIndex: number,
): Promise<{ safe: boolean; multiplier?: number; minePositions?: number[] }> {
  const redis = getRedis()
  const raw = await redis.get(redisKey(playerId))
  if (!raw) throw new AppError('GAME_NOT_FOUND', "You don't have a mines game in progress.", 404)

  const state = JSON.parse(raw) as MinesGameState
  if (state.gameId !== gameId || state.status !== 'active') {
    throw new AppError('GAME_NOT_FOUND', "You don't have a mines game in progress.", 404)
  }
  if (state.revealedTiles.includes(tileIndex)) {
    throw new AppError('TILE_ALREADY_REVEALED', "You've already revealed that tile.", 400)
  }

  if (state.minePositions.includes(tileIndex)) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // Lock the bet row and only settle if it is still active, so a mine-hit
      // racing a cashout (or a duplicate reveal) can't double-release the stake.
      const { rows } = await client.query<{ effective_stake: string; fund_source: 'cash' | 'bonus' }>(
        `SELECT effective_stake, fund_source FROM bets
         WHERE id = $1 AND player_id = $2 AND status = 'active' FOR UPDATE`,
        [state.betId, playerId],
      )
      if (rows.length > 0) {
        // Bonus-funded bets never reserve locked_balance (the stake left
        // bonus_balance outright at debit), so only cash bets release it here.
        if (rows[0].fund_source === 'cash') {
          await client.query(
            `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
            [Number(rows[0].effective_stake), playerId],
          )
        }
        await client.query(
          `UPDATE bets SET status = 'lost', settled_at = NOW() WHERE id = $1`, [state.betId],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    await redis.del(redisKey(playerId))
    return { safe: false, minePositions: state.minePositions }
  }

  const totalTiles = state.gridSize * state.gridSize
  const safeTiles = totalTiles - state.mineCount
  const newMultiplier = nextMultiplier(state.currentMultiplier, safeTiles, totalTiles, state.revealedTiles.length)
  state.revealedTiles.push(tileIndex)
  state.currentMultiplier = newMultiplier
  await redis.setex(redisKey(playerId), GAME_TTL, JSON.stringify(state))
  return { safe: true, multiplier: payoutMultiplier(newMultiplier) }
}

export async function cashoutMines(
  playerId: string, gameId: string,
): Promise<{ winnings: number; minePositions: number[]; serverSeed: string }> {
  const redis = getRedis()
  const raw = await redis.get(redisKey(playerId))
  if (!raw) throw new AppError('GAME_NOT_FOUND', "You don't have a mines game in progress.", 404)

  const state = JSON.parse(raw) as MinesGameState
  if (state.gameId !== gameId || state.status !== 'active') {
    throw new AppError('GAME_NOT_FOUND', "You don't have a mines game in progress.", 404)
  }
  if (state.revealedTiles.length === 0) {
    throw new AppError('NO_TILES_REVEALED', 'Reveal at least one tile before cashing out', 400)
  }

  const client = await pool.connect()
  let winnings = 0
  try {
    await client.query('BEGIN')
    // Atomic guard: lock the bet and only pay out if it is still active. A
    // second concurrent cashout (or a racing mine-hit) blocks here, then finds
    // 0 rows and is rejected - closing the double-payout race.
    const { rows } = await client.query<{ effective_stake: string; fund_source: 'cash' | 'bonus'; bonus_grant_id: string | null }>(
      `SELECT effective_stake, fund_source, bonus_grant_id FROM bets
       WHERE id = $1 AND player_id = $2 AND status = 'active' FOR UPDATE`,
      [state.betId, playerId],
    )
    if (rows.length === 0) throw new AppError('GAME_NOT_FOUND', "You don't have a mines game in progress.", 404)

    const effectiveStake = Number(rows[0].effective_stake)
    const paidMultiplier = payoutMultiplier(state.currentMultiplier)
    winnings = Math.floor(effectiveStake * paidMultiplier)

    if (rows[0].fund_source === 'bonus') {
      await settleBonusWin(client, playerId, rows[0].bonus_grant_id!, winnings, effectiveStake, state.betId, await getBonusMaxWinCents())
      // Bonus stake was never locked, so there is no locked_balance to release.
    } else {
      await creditWinnings(client, playerId, winnings, { game: 'mines', gameId, multiplier: paidMultiplier })
      await client.query(
        `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
        [effectiveStake, playerId],
      )
    }
    await client.query(
      `UPDATE bets SET status = 'won', cashout_multiplier = $1, winnings = $2, settled_at = NOW() WHERE id = $3`,
      [paidMultiplier, winnings, state.betId],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  await redis.del(redisKey(playerId))
  return { winnings, minePositions: state.minePositions, serverSeed: state.serverSeed }
}
