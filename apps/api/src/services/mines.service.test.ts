import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('../lib/redis.js', () => ({ getRedis: vi.fn() }))
vi.mock('../lib/crash-rng.js', () => ({ generateMinePositions: vi.fn(() => [2, 5]) }))
vi.mock('./wallet.service.js', () => ({
  debitForBet: vi.fn(async () => ({ transactionId: 'tx-1', walletId: 'w-1' })),
  creditWinnings: vi.fn(async () => ({ transactionId: 'tx-2', walletId: 'w-1' })),
}))
vi.mock('./crash.service.js', () => ({ getHouseEdge: vi.fn(async () => 5) }))

import { pool } from '@betting/db'
import { getRedis } from '../lib/redis.js'
import { creditWinnings } from './wallet.service.js'
import { startGame, revealTile, cashoutMines } from './mines.service.js'

const mockConnect = vi.mocked(pool.connect)
const mockRedis = { get: vi.fn(), setex: vi.fn(), del: vi.fn() }

function makeMockClient(rows: any[][] = []) {
  let i = 0
  return {
    query: vi.fn(async () => { const r = rows[i] ?? []; i++; return { rows: r } }),
    release: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRedis).mockReturnValue(mockRedis as any)
  mockRedis.get.mockResolvedValue(null)
})

const activeGame = {
  gameId: 'g-1', playerId: 'p-1', gridSize: 3, mineCount: 2,
  minePositions: [2, 5], serverSeed: 'seed', serverSeedHash: 'hash',
  clientSeed: 'client', revealedTiles: [], effectiveStake: 10000,
  currentMultiplier: 0.95, status: 'active', betId: 'bet-1',
}

describe('startGame', () => {
  it('stores game state in Redis and returns gameId', async () => {
    // BEGIN at idx 0 (ignored), INSERT bets at idx 1
    const client = makeMockClient([[], [{ id: 'bet-1' }]])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await startGame('p-1', 10000, 3, 2)

    expect(mockRedis.setex).toHaveBeenCalled()
    expect(result.gridSize).toBe(3)
    expect(result.mineCount).toBe(2)
    expect(result.serverSeedHash).toBeDefined()
  })

  it('throws GAME_ALREADY_ACTIVE when player has active game', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify({ ...activeGame, status: 'active' }))
    await expect(startGame('p-1', 10000, 3, 2)).rejects.toMatchObject({ code: 'GAME_ALREADY_ACTIVE' })
  })
})

describe('revealTile', () => {
  it('returns safe:true and updated multiplier for a safe tile', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(activeGame))
    const result = await revealTile('p-1', 'g-1', 0)
    expect(result.safe).toBe(true)
    expect(result.multiplier).toBeGreaterThan(1.0)
  })

  it('returns safe:false and mine positions when hitting a mine', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(activeGame))
    // BEGIN at idx 0, UPDATE wallets at idx 1, UPDATE bets at idx 2
    const client = makeMockClient([[{}], [{}]])
    mockConnect.mockResolvedValueOnce(client as any)
    const result = await revealTile('p-1', 'g-1', 2)
    expect(result.safe).toBe(false)
    expect(result.minePositions).toEqual([2, 5])
    expect(mockRedis.del).toHaveBeenCalled()
  })
})

describe('cashoutMines', () => {
  it('credits winnings and returns mine positions + serverSeed', async () => {
    const game = { ...activeGame, revealedTiles: [0, 1], currentMultiplier: 1.35 }
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(game))
    // BEGIN at idx 0, creditWinnings mocked, UPDATE locked_balance at idx 1, UPDATE bets at idx 2
    const client = makeMockClient([[{}], [{}]])
    mockConnect.mockResolvedValueOnce(client as any)
    const result = await cashoutMines('p-1', 'g-1')
    expect(result.winnings).toBe(13500)
    expect(result.minePositions).toEqual([2, 5])
    expect(creditWinnings).toHaveBeenCalled()
  })
})
