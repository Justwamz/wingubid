import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('./game-settings.service.js', () => ({
  assertGameEnabled: vi.fn(async () => {}),
  getBonusMaxWinCents: vi.fn(async () => 1_000_000),
}))
vi.mock('../lib/crash-rng.js', () => ({ rollDiceResult: vi.fn() }))
vi.mock('./wallet.service.js', () => ({
  debitForBet: vi.fn(async () => ({ transactionId: 'tx-1', walletId: 'w-1' })),
  creditWinnings: vi.fn(async () => ({ transactionId: 'tx-2', walletId: 'w-1' })),
  debitBonusForBet: vi.fn(async () => ({ walletId: 'w-1', grantId: 'g-1' })),
  settleBonusWin: vi.fn(async () => ({ net: 15000 })),
}))
vi.mock('./crash.service.js', () => ({ getHouseEdge: vi.fn(async () => 1) }))
vi.mock('./dice-seed.service.js', () => ({
  nextDiceRoll: vi.fn(async () => ({
    serverSeed: 'srv', serverSeedHash: 'hash', clientSeed: 'cli', nonce: 7,
  })),
}))

import { pool } from '@betting/db'
import { rollDiceResult } from '../lib/crash-rng.js'
import { creditWinnings, debitBonusForBet, settleBonusWin } from './wallet.service.js'
import { getBonusMaxWinCents } from './game-settings.service.js'
import { nextDiceRoll } from './dice-seed.service.js'
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

// Query sequence with nextDiceRoll/debitForBet/creditWinnings mocked:
// BEGIN (idx 0), INSERT bets (idx 1), COMMIT (idx 2)
function diceClient() {
  return makeMockClient([[], [{ id: 'bet-1' }]])
}

beforeEach(() => vi.clearAllMocks())

describe('rollDice', () => {
  it('wins and calls creditWinnings when result >= target (over)', async () => {
    mockRoll.mockReturnValue(60)
    const client = diceClient()
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'over')
    expect(result.won).toBe(true)
    expect(result.result).toBe(60)
    expect(creditWinnings).toHaveBeenCalled()
  })

  it('exposes the committed hash + nonce, never the raw server seed', async () => {
    mockRoll.mockReturnValue(60)
    const client = diceClient()
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'over') as Record<string, unknown>
    expect(nextDiceRoll).toHaveBeenCalled()
    expect(result.serverSeedHash).toBe('hash')
    expect(result.nonce).toBe(7)
    expect(result.serverSeed).toBeUndefined()
  })

  it('loses and skips creditWinnings when result < target (over)', async () => {
    mockRoll.mockReturnValue(30)
    const client = diceClient()
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'over')
    expect(result.won).toBe(false)
    expect(result.winnings).toBe(0)
    expect(creditWinnings).not.toHaveBeenCalled()
  })

  it('wins for under direction when result < target', async () => {
    mockRoll.mockReturnValue(20)
    const client = diceClient()
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'under')
    expect(result.won).toBe(true)
    expect(creditWinnings).toHaveBeenCalled()
  })

  it('calculates multiplier as (100 - houseEdge) / winCount', async () => {
    mockRoll.mockReturnValue(75)
    const client = diceClient()
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'over')
    // houseEdge=1, winCount=50, multiplier = 99/50 = 1.98
    expect(result.multiplier).toBeCloseTo(1.98, 1)
  })

  it('bonus win debits from the bonus grant and settles net via settleBonusWin, recording fund_source=bonus', async () => {
    mockRoll.mockReturnValue(60)
    const client = diceClient()
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'over', 'bonus')

    expect(result.won).toBe(true)
    expect(debitBonusForBet).toHaveBeenCalledWith(
      client, 'p-1', 10000, expect.objectContaining({ game: 'dice' }),
    )
    expect(settleBonusWin).toHaveBeenCalledWith(
      client, 'p-1', 'g-1', result.winnings, 10000, 'bet-1', 1_000_000,
    )
    expect(getBonusMaxWinCents).toHaveBeenCalled()
    expect(creditWinnings).not.toHaveBeenCalled()

    const insertCall = client.query.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO bets'))
    expect(insertCall![1]).toEqual(expect.arrayContaining(['bonus', 'g-1']))
  })

  it('bonus loss debits the bonus grant but never calls settleBonusWin', async () => {
    mockRoll.mockReturnValue(30)
    const client = diceClient()
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await rollDice('p-1', 10000, 50, 'over', 'bonus')

    expect(result.won).toBe(false)
    expect(debitBonusForBet).toHaveBeenCalled()
    expect(settleBonusWin).not.toHaveBeenCalled()
    expect(creditWinnings).not.toHaveBeenCalled()
  })
})
