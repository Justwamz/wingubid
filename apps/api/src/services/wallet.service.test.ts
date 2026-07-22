import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))

import { pool } from '@betting/db'
import {
  getWalletBalance,
  debitForBet,
  creditDeposit,
  lockForWithdrawal,
  settleWithdrawal,
  creditWinnings,
  refundBet,
  settleBonusWin,
  sweepExpiredBonuses,
} from './wallet.service.js'

const mockQuery = vi.mocked(pool.query)
const mockConnect = vi.mocked(pool.connect)

function makeMockClient(rows: any[][] = []) {
  let callIndex = 0
  return {
    query: vi.fn(async () => {
      const r = rows[callIndex] ?? []
      callIndex++
      return { rows: r, rowCount: r.length }
    }),
    release: vi.fn(),
  }
}

beforeEach(() => { mockQuery.mockReset(); mockConnect.mockReset() })

describe('getWalletBalance', () => {
  it('returns wallet fields for player', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        wallet_id: 'w-1',
        balance: '10000',
        bonus_balance: '0',
        locked_balance: '0',
        currency: 'KES',
      }],
    } as any)

    const result = await getWalletBalance('player-1')

    expect(result).toEqual({
      walletId: 'w-1',
      balance: 10000,
      bonusBalance: 0,
      lockedBalance: 0,
      currency: 'KES',
    })
  })

  it('throws NOT_FOUND if wallet missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    await expect(getWalletBalance('bad-player')).rejects.toMatchObject({
      code: 'WALLET_NOT_FOUND',
    })
  })
})

describe('debitForBet', () => {
  it('debits gross from balance, adds effective to locked, inserts bet_placed tx', async () => {
    const client = makeMockClient([
      // SELECT FOR UPDATE
      [{ id: 'w-1', balance: '20000', currency: 'KES' }],
      // UPDATE wallets
      [{ balance: '10000' }],
      // INSERT transactions
      [{ id: 'tx-1' }],
    ])

    const result = await debitForBet(client as any, 'player-1', 10000, 8750, { roundId: 'r-1' })

    expect(result.transactionId).toBe('tx-1')
    const updateCall = client.query.mock.calls[1] as unknown as [string, unknown[]]
    expect(updateCall[0]).toContain('balance = balance - $1')
    expect(updateCall[0]).toContain('locked_balance = locked_balance + $2')
    expect(updateCall[1]).toContain(10000) // gross
    expect(updateCall[1]).toContain(8750)  // effective
  })

  it('throws INSUFFICIENT_FUNDS when balance too low', async () => {
    const client = makeMockClient([
      [{ id: 'w-1', balance: '500', currency: 'KES' }],
    ])

    await expect(
      debitForBet(client as any, 'player-1', 10000, 8750, {})
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' })
  })

  it('locks 0 when lock:false (instant-settle games must not reserve locked_balance)', async () => {
    const client = makeMockClient([
      [{ id: 'w-1', balance: '20000', currency: 'KES' }], // SELECT FOR UPDATE
      [{ balance: '10000' }],                              // UPDATE wallets
      [{ id: 'tx-1' }],                                    // INSERT transactions
    ])

    await debitForBet(client as any, 'player-1', 10000, 10000, { game: 'scratch' }, { lock: false })

    const updateCall = client.query.mock.calls[1] as unknown as [string, unknown[]]
    expect(updateCall[0]).toContain('locked_balance = locked_balance + $2')
    expect(updateCall[1][0]).toBe(10000) // gross still debited from balance
    expect(updateCall[1][1]).toBe(0)     // but nothing added to locked_balance
  })

  it('rejects effectiveStake greater than grossStake', async () => {
    const client = makeMockClient([])
    await expect(
      debitForBet(client as any, 'player-1', 10000, 20000, {})
    ).rejects.toMatchObject({ code: 'INVALID_STAKE' })
  })
})

describe('creditDeposit', () => {
  it('credits balance and inserts deposit tx', async () => {
    const client = makeMockClient([
      [{ id: 'w-1', balance: '0', currency: 'KES' }],
      [{ balance: '10000' }],
      [{ id: 'tx-2' }],
    ])

    const result = await creditDeposit(client as any, 'player-1', 10000, 'idem-key', {})
    expect(result.transactionId).toBe('tx-2')

    const insertCall = client.query.mock.calls[2] as unknown as [string, unknown[]]
    expect(insertCall[0]).toContain('INSERT INTO transactions')
    expect(insertCall[1]).toContain('deposit')
    expect(insertCall[1]).toContain('idem-key')
  })
})

describe('lockForWithdrawal', () => {
  it('moves amount from balance to locked, no tx inserted', async () => {
    const client = makeMockClient([
      [{ id: 'w-1', balance: '20000', currency: 'KES' }],
      [{ balance: '10000', locked_balance: '10000' }],
    ])

    await lockForWithdrawal(client as any, 'player-1', 10000)
    expect(client.query).toHaveBeenCalledTimes(2) // SELECT + UPDATE, no INSERT
  })

  it('throws INSUFFICIENT_FUNDS when balance too low', async () => {
    const client = makeMockClient([[{ id: 'w-1', balance: '500', currency: 'KES' }]])
    await expect(lockForWithdrawal(client as any, 'player-1', 10000))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' })
  })
})

describe('settleWithdrawal', () => {
  it('decrements locked and inserts completed withdrawal tx on success', async () => {
    const client = makeMockClient([
      [{ id: 'w-1', balance: '0', currency: 'KES' }],
      [{}],       // UPDATE wallets
      [{ id: 'tx-3' }], // INSERT tx
    ])

    await settleWithdrawal(client as any, 'player-1', 10000, 8000, true, {})

    const updateCall = client.query.mock.calls[1] as unknown as [string, unknown[]]
    expect(updateCall[0]).toContain('locked_balance = locked_balance - $1')
    const insertCall = client.query.mock.calls[2] as unknown as [string, unknown[]]
    expect(insertCall[1]).toContain('withdrawal')
    expect(insertCall[1]).toContain('completed')
    expect(insertCall[1]).toContain(8000) // net payout
  })

  it('returns funds to balance and inserts failed tx on failure', async () => {
    const client = makeMockClient([
      [{ id: 'w-1', balance: '0', currency: 'KES' }],
      [{}],
      [{ id: 'tx-4' }],
    ])

    await settleWithdrawal(client as any, 'player-1', 10000, 8000, false, {})

    const updateCall = client.query.mock.calls[1] as unknown as [string, unknown[]]
    expect(updateCall[0]).toContain('balance = balance + $2')
    const insertCall = client.query.mock.calls[2] as unknown as [string, unknown[]]
    expect(insertCall[1]).toContain('failed')
  })
})

describe('settleBonusWin', () => {
  it('credits net = payout - stake to cash', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = []
    const client = { query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params })
      if (sql.includes('SELECT id, balance')) return { rows: [{ id: 'w1', balance: '0', currency: 'KES' }] }
      if (sql.startsWith('UPDATE wallets')) return { rows: [{ balance: '15000' }] }
      return { rows: [{ id: 'tx1' }] }
    }) } as never
    const { net } = await settleBonusWin(client, 'p1', 'g1', 25000, 10000, 'b1', 1_000_000)
    expect(net).toBe(15000) // 25000 payout - 10000 stake
  })

  it('caps net at maxWinCents', async () => {
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, balance')) return { rows: [{ id: 'w1', balance: '0', currency: 'KES' }] }
      if (sql.startsWith('UPDATE wallets')) return { rows: [{ balance: '1000000' }] }
      return { rows: [{ id: 'tx1' }] }
    }) } as never
    const { net } = await settleBonusWin(client, 'p1', 'g1', 5_000_000, 100_000, 'b1', 1_000_000)
    expect(net).toBe(1_000_000) // capped
  })

  it('credits nothing when payout <= stake', async () => {
    const updates: string[] = []
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, balance')) return { rows: [{ id: 'w1', balance: '0', currency: 'KES' }] }
      if (sql.startsWith('UPDATE wallets')) { updates.push(sql); return { rows: [{ balance: '0' }] } }
      return { rows: [{ id: 'tx1' }] }
    }) } as never
    const { net } = await settleBonusWin(client, 'p1', 'g1', 5000, 10000, 'b1', 1_000_000)
    expect(net).toBe(0)
    expect(updates.length).toBe(0) // no cash credit performed
  })
})

describe('sweepExpiredBonuses', () => {
  it('forfeits an expired active grant in its own committed transaction, wallet-first', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'grant-1', player_id: 'p-1' }],
    } as any)

    const client = makeMockClient([
      [],                                                        // BEGIN
      [{ id: 'w-1', balance: '5000', currency: 'KES' }],         // selectWalletForUpdate
      [{ player_id: 'p-1', wallet_id: 'w-1', remaining: '500' }], // forfeitBonus: SELECT grant FOR UPDATE
      [{ bonus_balance: '0' }],                                  // forfeitBonus: UPDATE wallets bonus_balance
      [],                                                        // forfeitBonus: UPDATE bonus_grants
      [],                                                        // forfeitBonus: INSERT transactions (bonus_forfeited)
      [],                                                        // COMMIT
    ])
    mockConnect.mockResolvedValueOnce(client as any)

    const count = await sweepExpiredBonuses()

    expect(count).toBe(1)
    const calls = client.query.mock.calls
    expect(calls[0][0]).toBe('BEGIN')
    // Wallet lock happens before the grant lock - same order debitBonusForBet
    // uses - so this sweep can never ABBA-deadlock a concurrent bonus bet.
    expect(calls[1][0]).toContain('FROM wallets')
    expect(calls[1][0]).toContain('FOR UPDATE')
    expect(calls[2][0]).toContain('FROM bonus_grants')
    expect(calls[2][0]).toContain('FOR UPDATE')
    const grantUpdateCall = calls.find(([sql]: any[]) => typeof sql === 'string' && sql.includes('UPDATE bonus_grants SET remaining = 0'))
    expect(grantUpdateCall![1]).toEqual(['grant-1', 'expired'])
    expect(calls[calls.length - 1][0]).toBe('COMMIT')
    expect(client.release).toHaveBeenCalled()
  })

  it('does nothing when there are no expired grants', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const count = await sweepExpiredBonuses()

    expect(count).toBe(0)
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('rolls back and continues past a single grant failure without aborting the sweep', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'grant-fail', player_id: 'p-fail' },
        { id: 'grant-ok', player_id: 'p-ok' },
      ],
    } as any)

    const failingClient = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] }
        throw new Error('wallet lock failed')
      }),
      release: vi.fn(),
    }
    const okClient = makeMockClient([
      [],
      [{ id: 'w-2', balance: '5000', currency: 'KES' }],
      [{ player_id: 'p-ok', wallet_id: 'w-2', remaining: '300' }],
      [{ bonus_balance: '0' }],
      [],
      [],
      [],
    ])
    mockConnect
      .mockResolvedValueOnce(failingClient as any)
      .mockResolvedValueOnce(okClient as any)

    const count = await sweepExpiredBonuses()

    expect(count).toBe(1)
    expect(failingClient.query).toHaveBeenCalledWith('ROLLBACK')
    expect(failingClient.release).toHaveBeenCalled()
    expect(okClient.release).toHaveBeenCalled()
  })
})
