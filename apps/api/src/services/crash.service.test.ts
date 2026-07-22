import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('./game-settings.service.js', () => ({
  assertGameEnabled: vi.fn(async () => {}),
  getBonusMaxWinCents: vi.fn(async () => 1_000_000),
}))
vi.mock('./wallet.service.js', () => ({
  debitForBet: vi.fn(async () => ({ transactionId: 'tx-1', walletId: 'w-1' })),
  creditWinnings: vi.fn(async () => ({ transactionId: 'tx-2', walletId: 'w-1' })),
  debitBonusForBet: vi.fn(async () => ({ walletId: 'w-1', grantId: 'g-1' })),
  settleBonusWin: vi.fn(async () => ({ net: 15000 })),
}))

import { pool } from '@betting/db'
import { debitForBet, creditWinnings, debitBonusForBet, settleBonusWin } from './wallet.service.js'
import { getBonusMaxWinCents } from './game-settings.service.js'
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
      [],                                            // BEGIN
      [{ id: 'bet-1', effective_stake: '10000' }],  // INSERT bets
      // COMMIT: beyond array → []
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await placeBet('p-1', 'round-1', 10000, undefined)
    expect(result.betId).toBe('bet-1')
    expect(result.effectiveStake).toBe(10000)
    expect(debitForBet).toHaveBeenCalled()
  })

  it('throws INSUFFICIENT_FUNDS when balance too low', async () => {
    const client = makeMockClient([
      [], // BEGIN
      // ROLLBACK: beyond array → []
    ])
    mockConnect.mockResolvedValueOnce(client as any)
    vi.mocked(debitForBet).mockRejectedValueOnce(
      Object.assign(new Error('insufficient'), { code: 'INSUFFICIENT_FUNDS' }),
    )

    await expect(placeBet('p-1', 'round-1', 10000, undefined))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' })
    expect(client.release).toHaveBeenCalled()
  })

  it('bonus stake debits from the bonus grant and records fund_source + bonus_grant_id on the bet', async () => {
    const client = makeMockClient([
      [],                                            // BEGIN
      [{ id: 'bet-1', effective_stake: '10000' }],  // INSERT bets
      // COMMIT: beyond array → []
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await placeBet('p-1', 'round-1', 10000, undefined, 'bonus')

    expect(debitBonusForBet).toHaveBeenCalledWith(
      client, 'p-1', 10000, expect.objectContaining({ game: 'crash' }),
    )
    expect(result.betId).toBe('bet-1')
    const insertCall = client.query.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO bets'))
    expect(insertCall).toBeDefined()
    expect(insertCall![0]).toContain('fund_source')
    expect(insertCall![0]).toContain('bonus_grant_id')
    expect(insertCall![1]).toEqual(expect.arrayContaining(['bonus', 'g-1']))
  })
})

describe('cashout', () => {
  it('credits winnings, marks bet won, returns winnings', async () => {
    const client = makeMockClient([
      [],                                                                                        // BEGIN
      [{ id: 'bet-1', effective_stake: '10000', fund_source: 'cash', bonus_grant_id: null }],   // SELECT bet FOR UPDATE
      [{}],                                                                                      // UPDATE wallets locked_balance
      [{}],                                                                                      // UPDATE bets
      // COMMIT: beyond array → []
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await cashout('p-1', 'bet-1', 2.00, 5.00)
    expect(result.winnings).toBe(20000)
    expect(creditWinnings).toHaveBeenCalled()
  })

  it('throws ROUND_CRASHED when multiplier is at/above the crash point', async () => {
    await expect(cashout('p-1', 'bet-1', 5.00, 5.00))
      .rejects.toMatchObject({ code: 'ROUND_CRASHED' })
  })

  it('throws BET_NOT_FOUND when bet not active', async () => {
    const client = makeMockClient([
      [], // BEGIN
      [], // SELECT bet FOR UPDATE → empty → throws BET_NOT_FOUND
      // ROLLBACK: beyond array → []
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    await expect(cashout('p-1', 'bet-999', 2.00, 5.00))
      .rejects.toMatchObject({ code: 'BET_NOT_FOUND' })
  })

  it('bonus cashout settles net via settleBonusWin and does NOT decrement locked_balance', async () => {
    const client = makeMockClient([
      [],                                                                                          // BEGIN
      [{ id: 'bet-1', effective_stake: '10000', fund_source: 'bonus', bonus_grant_id: 'g-1' }],  // SELECT bet FOR UPDATE
      [{}],                                                                                        // UPDATE bets
      // COMMIT: beyond array → []
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await cashout('p-1', 'bet-1', 2.00, 5.00)

    expect(result.winnings).toBe(20000)
    expect(settleBonusWin).toHaveBeenCalledWith(client, 'p-1', 'g-1', 20000, 10000, 'bet-1', 1_000_000)
    expect(getBonusMaxWinCents).toHaveBeenCalled()
    expect(creditWinnings).not.toHaveBeenCalled()
    const lockedBalanceCall = client.query.mock.calls.find(([sql]: [string]) => sql.includes('locked_balance'))
    expect(lockedBalanceCall).toBeUndefined()
  })
})

describe('settleLostBets', () => {
  it('marks active bets as lost and decrements locked_balance', async () => {
    const client = makeMockClient([
      [],                                                                             // BEGIN
      [                                                                               // SELECT active bets
        { id: 'bet-1', player_id: 'p-1', effective_stake: '10000', fund_source: 'cash' },
        { id: 'bet-2', player_id: 'p-2', effective_stake: '5000', fund_source: 'cash' },
      ],
      [{}], // UPDATE bets lost
      [{}], // UPDATE wallets p-1 locked
      [{}], // UPDATE wallets p-2 locked
      [{}], // UPDATE game_rounds
      // COMMIT: beyond array → []
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    await settleLostBets('round-1', 'revealed-seed', 1.23)

    const betCall = client.query.mock.calls[2] as unknown as [string, unknown[]]
    expect(betCall[0]).toContain("status = 'lost'")
    const lockedCalls = client.query.mock.calls.filter(([sql]: [string]) => sql.includes('locked_balance'))
    expect(lockedCalls).toHaveLength(2)
  })

  it('still updates game_round when no active bets', async () => {
    const client = makeMockClient([
      [],   // BEGIN
      [],   // SELECT active bets → empty
      [{}], // UPDATE game_rounds
      // COMMIT: beyond array → []
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    await expect(settleLostBets('round-1', 'seed', 1.00)).resolves.toBeUndefined()
  })

  it('marks a bonus-funded lost bet as lost WITHOUT decrementing locked_balance', async () => {
    const client = makeMockClient([
      [],                                                                              // BEGIN
      [                                                                                // SELECT active bets
        { id: 'bet-1', player_id: 'p-1', effective_stake: '10000', fund_source: 'cash' },
        { id: 'bet-2', player_id: 'p-2', effective_stake: '5000', fund_source: 'bonus' },
      ],
      [{}], // UPDATE bets lost
      [{}], // UPDATE wallets p-1 locked (cash only)
      [{}], // UPDATE game_rounds
      // COMMIT: beyond array → []
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    await settleLostBets('round-1', 'seed', 1.23)

    const lockedCalls = client.query.mock.calls.filter(
      ([sql, params]: [string, unknown[]]) => sql.includes('locked_balance'),
    )
    expect(lockedCalls).toHaveLength(1)
    expect(lockedCalls[0][1]).toEqual([10000, 'p-1'])
  })
})
