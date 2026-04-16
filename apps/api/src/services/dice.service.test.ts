import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('../lib/crash-rng.js', () => ({ rollDiceResult: vi.fn() }))
vi.mock('./wallet.service.js', () => ({
  debitForBet: vi.fn(async () => ({ transactionId: 'tx-1', walletId: 'w-1' })),
  creditWinnings: vi.fn(async () => ({ transactionId: 'tx-2', walletId: 'w-1' })),
}))
vi.mock('./crash.service.js', () => ({ getHouseEdge: vi.fn(async () => 1) }))

import { pool } from '@betting/db'
import { rollDiceResult } from '../lib/crash-rng.js'
import { creditWinnings } from './wallet.service.js'
import { rollDice } from './dice.service.js'

const mockConnect = vi.mocked(pool.connect)
const mockRoll = vi.mocked(rollDiceResult)

function makeMockClient(rows: any[][] = []) {
  let i = 0
  return {
    query: vi.fn(async () => { const r = rows[i] ?? []; i++; return { rows: r } }),
    release: vi.fn(),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('rollDice', () => {
  it('wins and calls creditWinnings when result >= target (over)', async () => {
    mockRoll.mockReturnValue(60)
    // BEGIN idx 0, SELECT nonce idx 1, INSERT bets idx 2, UPDATE locked idx 3
    const client = makeMockClient([
      [{ count: '0' }],  // BEGIN (ignored)
      [{ count: '0' }],  // SELECT nonce
      [{ id: 'bet-1' }], // INSERT bets
      [{}],              // UPDATE locked_balance
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'over')
    expect(result.won).toBe(true)
    expect(result.result).toBe(60)
    expect(creditWinnings).toHaveBeenCalled()
  })

  it('loses and skips creditWinnings when result < target (over)', async () => {
    mockRoll.mockReturnValue(30)
    const client = makeMockClient([[{ count: '3' }], [{ count: '3' }], [{ id: 'bet-1' }], [{}]])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'over')
    expect(result.won).toBe(false)
    expect(result.winnings).toBe(0)
    expect(creditWinnings).not.toHaveBeenCalled()
  })

  it('wins for under direction when result < target', async () => {
    mockRoll.mockReturnValue(20)
    const client = makeMockClient([[{ count: '0' }], [{ count: '0' }], [{ id: 'bet-1' }], [{}]])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'under')
    expect(result.won).toBe(true)
    expect(creditWinnings).toHaveBeenCalled()
  })

  it('calculates multiplier as (100 - houseEdge) / winCount', async () => {
    mockRoll.mockReturnValue(75)
    const client = makeMockClient([[{ count: '0' }], [{ count: '0' }], [{ id: 'bet-1' }], [{}]])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'over')
    // houseEdge=1, winCount=50, multiplier = 99/50 = 1.98
    expect(result.multiplier).toBeCloseTo(1.98, 1)
  })
})
