import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@betting/db'
import {
  getWalletBalance,
  debitForBet,
  creditDeposit,
  lockForWithdrawal,
  settleWithdrawal,
  creditWinnings,
  refundBet,
} from './wallet.service.js'

const mockQuery = vi.mocked(pool.query)

function makeMockClient(rows: any[][] = []) {
  let callIndex = 0
  return {
    query: vi.fn(async () => {
      const r = rows[callIndex] ?? []
      callIndex++
      return { rows: r, rowCount: r.length }
    }),
  }
}

beforeEach(() => { mockQuery.mockReset() })

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
