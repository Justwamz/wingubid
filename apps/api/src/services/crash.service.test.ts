import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))

import { pool } from '@betting/db'
import { placeBet, cashout, settleLostBets } from './crash.service.js'

const mockConnect = vi.mocked(pool.connect)

function makeMockClient(rows: any[][] = []) {
  let i = 0
  return {
    query: vi.fn(async () => { const r = rows[i] ?? []; i++; return { rows: r } }),
    release: vi.fn(),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('placeBet', () => {
  it('debits wallet, inserts bet row, returns betId', async () => {
    const client = makeMockClient([
      [{ id: 'w-1', balance: '50000', currency: 'KES' }], // selectWalletForUpdate
      [{ balance: '40000' }],                              // UPDATE wallets
      [{ id: 'tx-1' }],                                   // INSERT transactions
      [{ id: 'bet-1', effective_stake: '10000' }],        // INSERT bets
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await placeBet('p-1', 'round-1', 10000, undefined)
    expect(result.betId).toBe('bet-1')
    expect(result.effectiveStake).toBe(10000)
  })

  it('throws INSUFFICIENT_FUNDS when balance too low', async () => {
    const client = makeMockClient([[{ id: 'w-1', balance: '500', currency: 'KES' }]])
    mockConnect.mockResolvedValueOnce(client as any)

    await expect(placeBet('p-1', 'round-1', 10000, undefined))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' })
    expect(client.release).toHaveBeenCalled()
  })
})

describe('cashout', () => {
  it('credits winnings, marks bet won, returns winnings', async () => {
    const client = makeMockClient([
      [{ id: 'bet-1', effective_stake: '10000', status: 'active' }], // SELECT bet FOR UPDATE
      [{ id: 'w-1', balance: '0', currency: 'KES' }],               // selectWalletForUpdate
      [{ balance: '20000' }],                                        // UPDATE wallets balance
      [{ id: 'tx-2' }],                                             // INSERT transactions
      [{}],                                                          // UPDATE wallets locked_balance
      [{}],                                                          // UPDATE bets
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await cashout('p-1', 'bet-1', 2.00)
    expect(result.winnings).toBe(20000)
  })

  it('throws BET_NOT_FOUND when bet not active', async () => {
    const client = makeMockClient([[]])
    mockConnect.mockResolvedValueOnce(client as any)

    await expect(cashout('p-1', 'bet-999', 2.00))
      .rejects.toMatchObject({ code: 'BET_NOT_FOUND' })
  })
})

describe('settleLostBets', () => {
  it('marks active bets as lost and decrements locked_balance', async () => {
    const client = makeMockClient([
      [
        { id: 'bet-1', player_id: 'p-1', effective_stake: '10000' },
        { id: 'bet-2', player_id: 'p-2', effective_stake: '5000' },
      ],
      [{}], // UPDATE bets lost
      [{}], // UPDATE wallets p-1 locked
      [{}], // UPDATE wallets p-2 locked
      [{}], // UPDATE game_rounds
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    await settleLostBets('round-1', 'revealed-seed', 1.23)

    const betCall = client.query.mock.calls[1] as unknown as [string, unknown[]]
    expect(betCall[0]).toContain("status = 'lost'")
  })

  it('still updates game_round when no active bets', async () => {
    const client = makeMockClient([[], [{}]])
    mockConnect.mockResolvedValueOnce(client as any)

    await expect(settleLostBets('round-1', 'seed', 1.00)).resolves.toBeUndefined()
  })
})
