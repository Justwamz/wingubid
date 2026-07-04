import { randomBytes, createHash } from 'crypto'
import { pool } from '@betting/db'
import { getRedis } from '../lib/redis.js'
import { debitForBet, creditWinnings } from './wallet.service.js'
import { generateMinePositions } from '../lib/crash-rng.js'
import { getHouseEdge } from './crash.service.js'
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

export async function startGame(
  playerId: string, grossStake: number, gridSize: number, mineCount: number,
): Promise<{ gameId: string; serverSeedHash: string; clientSeed: string; gridSize: number; mineCount: number }> {
  const redis = getRedis()
  const existing = await redis.get(redisKey(playerId))
  if (existing && (JSON.parse(existing) as MinesGameState).status === 'active') {
    throw new AppError('GAME_ALREADY_ACTIVE', 'You already have an active mines game', 422)
  }

  const totalTiles = gridSize * gridSize
  if (mineCount < 1 || mineCount >= totalTiles) {
    throw new AppError('INVALID_MINE_COUNT', 'Invalid mine count', 400)
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
    const { walletId } = await debitForBet(client, playerId, grossStake, grossStake, { game: 'mines', gameId })
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO bets (player_id, wallet_id, game_type, gross_stake, wager_tax, effective_stake)
       VALUES ($1, $2, 'mines', $3, 0, $4) RETURNING id`,
      [playerId, walletId, grossStake, grossStake],
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

export async function revealTile(
  playerId: string, gameId: string, tileIndex: number,
): Promise<{ safe: boolean; multiplier?: number; minePositions?: number[] }> {
  const redis = getRedis()
  const raw = await redis.get(redisKey(playerId))
  if (!raw) throw new AppError('GAME_NOT_FOUND', 'No active mines game', 404)

  const state = JSON.parse(raw) as MinesGameState
  if (state.gameId !== gameId || state.status !== 'active') {
    throw new AppError('GAME_NOT_FOUND', 'No active mines game', 404)
  }
  if (state.revealedTiles.includes(tileIndex)) {
    throw new AppError('TILE_ALREADY_REVEALED', 'Tile already revealed', 400)
  }

  if (state.minePositions.includes(tileIndex)) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // Lock the bet row and only settle if it is still active, so a mine-hit
      // racing a cashout (or a duplicate reveal) can't double-release the stake.
      const { rows } = await client.query<{ effective_stake: string }>(
        `SELECT effective_stake FROM bets
         WHERE id = $1 AND player_id = $2 AND status = 'active' FOR UPDATE`,
        [state.betId, playerId],
      )
      if (rows.length > 0) {
        await client.query(
          `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
          [Number(rows[0].effective_stake), playerId],
        )
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
  return { safe: true, multiplier: newMultiplier }
}

export async function cashoutMines(
  playerId: string, gameId: string,
): Promise<{ winnings: number; minePositions: number[]; serverSeed: string }> {
  const redis = getRedis()
  const raw = await redis.get(redisKey(playerId))
  if (!raw) throw new AppError('GAME_NOT_FOUND', 'No active mines game', 404)

  const state = JSON.parse(raw) as MinesGameState
  if (state.gameId !== gameId || state.status !== 'active') {
    throw new AppError('GAME_NOT_FOUND', 'No active mines game', 404)
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
    // 0 rows and is rejected — closing the double-payout race.
    const { rows } = await client.query<{ effective_stake: string }>(
      `SELECT effective_stake FROM bets
       WHERE id = $1 AND player_id = $2 AND status = 'active' FOR UPDATE`,
      [state.betId, playerId],
    )
    if (rows.length === 0) throw new AppError('GAME_NOT_FOUND', 'No active mines game', 404)

    const effectiveStake = Number(rows[0].effective_stake)
    winnings = Math.floor(effectiveStake * state.currentMultiplier)

    await creditWinnings(client, playerId, winnings, { game: 'mines', gameId, multiplier: state.currentMultiplier })
    await client.query(
      `UPDATE wallets SET locked_balance = locked_balance - $1 WHERE player_id = $2`,
      [effectiveStake, playerId],
    )
    await client.query(
      `UPDATE bets SET status = 'won', cashout_multiplier = $1, winnings = $2, settled_at = NOW() WHERE id = $3`,
      [state.currentMultiplier, winnings, state.betId],
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
