import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('./wallet.service.js', () => ({
  creditDeposit: vi.fn(async () => ({ transactionId: 'tx-1', walletId: 'w-1' })),
  lockForWithdrawal: vi.fn(async () => ({ walletId: 'w-1' })),
  settleWithdrawal: vi.fn(async () => undefined),
  getWalletBalance: vi.fn(async () => ({
    walletId: 'w-1', balance: 100000, bonusBalance: 0, lockedBalance: 0, currency: 'KES',
  })),
}))
vi.mock('./providers/index.js', () => ({
  getProvider: vi.fn(() => ({
    name: 'mpesa',
    deposit: vi.fn(async () => ({ providerRef: 'stub-ref-001' })),
    withdraw: vi.fn(async () => ({ providerRef: 'stub-ref-002' })),
  })),
}))

import { pool } from '@betting/db'
import { creditDeposit, settleWithdrawal } from './wallet.service.js'
import { initiateDeposit, confirmDeposit } from './payment.service.js'

const mockQuery = vi.mocked(pool.query)
const mockConnect = vi.mocked(pool.connect)

function makeMockClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  }
}

beforeEach(() => {
  mockQuery.mockReset()
  mockConnect.mockReset()
  vi.mocked(creditDeposit).mockReset()
  vi.mocked(settleWithdrawal).mockReset()
  vi.mocked(creditDeposit).mockResolvedValue({ transactionId: 'tx-1', walletId: 'w-1' })
})

describe('initiateDeposit', () => {
  it('returns transactionId and providerRef on success', async () => {
    // player lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'player-1', phone: '+254700000000', currency: 'KES', country: 'KE' }],
    } as any)
    // country_settings lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{ min_deposit: 10000, max_deposit: 15000000 }],
    } as any)
    // INSERT payment_transactions
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'pt-1' }] } as any)
    // UPDATE awaiting_callback
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const result = await initiateDeposit('player-1', 50000, 'mpesa')

    expect(result.transactionId).toBe('pt-1')
    expect(result.providerRef).toBe('stub-ref-001')
  })

  it('throws LIMIT_EXCEEDED when amount below min_deposit', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'player-1', phone: '+254700000000', currency: 'KES', country: 'KE' }],
    } as any)
    mockQuery.mockResolvedValueOnce({
      rows: [{ min_deposit: 10000, max_deposit: 15000000 }],
    } as any)

    await expect(initiateDeposit('player-1', 500, 'mpesa')).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
  })

  it('returns existing record for duplicate idempotency key', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'player-1', phone: '+254700000000', currency: 'KES', country: 'KE' }],
    } as any)
    mockQuery.mockResolvedValueOnce({
      rows: [{ min_deposit: 10000, max_deposit: 15000000 }],
    } as any)
    // INSERT fails with unique constraint
    const err = Object.assign(new Error('unique'), { code: '23505' })
    mockQuery.mockRejectedValueOnce(err)
    // Fallback SELECT
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'pt-existing', provider_ref: 'stub-ref-old', status: 'awaiting_callback' }],
    } as any)

    const result = await initiateDeposit('player-1', 50000, 'mpesa')
    expect(result.transactionId).toBe('pt-existing')
  })
})

describe('confirmDeposit', () => {
  it('credits wallet and marks payment completed on success', async () => {
    const client = makeMockClient()
    mockConnect.mockResolvedValueOnce(client as any)

    client.query
      .mockResolvedValueOnce({ rows: [] } as any) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'pt-1', player_id: 'player-1', amount: 50000, status: 'awaiting_callback' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE status=completed
      .mockResolvedValueOnce({ rows: [] } as any) // COMMIT

    await confirmDeposit('stub-ref-001', true)

    expect(creditDeposit).toHaveBeenCalledWith(
      client,
      'player-1',
      50000,
      expect.any(String),
      expect.any(Object),
    )
  })

  it('is idempotent - does nothing if already completed', async () => {
    const client = makeMockClient()
    mockConnect.mockResolvedValueOnce(client as any)

    client.query
      .mockResolvedValueOnce({ rows: [] } as any) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'pt-1', player_id: 'player-1', amount: 50000, status: 'completed' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // COMMIT

    await confirmDeposit('stub-ref-001', true)
    expect(creditDeposit).not.toHaveBeenCalled()
  })

  it('returns without throwing when providerRef not found', async () => {
    const client = makeMockClient()
    mockConnect.mockResolvedValueOnce(client as any)

    client.query
      .mockResolvedValueOnce({ rows: [] } as any) // BEGIN
      .mockResolvedValueOnce({ rows: [] } as any) // SELECT → not found
      .mockResolvedValueOnce({ rows: [] } as any) // COMMIT

    await expect(confirmDeposit('unknown-ref', true)).resolves.toBeUndefined()
  })

  function pendingClient() {
    const client = makeMockClient()
    client.query
      .mockResolvedValueOnce({ rows: [] } as any) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'pt-1', player_id: 'player-1', amount: 50000, currency: 'KES', status: 'awaiting_callback' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE (failed or completed)
      .mockResolvedValueOnce({ rows: [] } as any) // COMMIT
    return client
  }

  it('C3: does not credit when the confirmed amount is short', async () => {
    const client = pendingClient()
    mockConnect.mockResolvedValueOnce(client as any)
    await confirmDeposit('stub-ref-001', true, undefined, { amount: 100 })
    expect(creditDeposit).not.toHaveBeenCalled()
  })

  it('C3: does not credit on a currency mismatch', async () => {
    const client = pendingClient()
    mockConnect.mockResolvedValueOnce(client as any)
    await confirmDeposit('stub-ref-001', true, undefined, { currency: 'UGX' })
    expect(creditDeposit).not.toHaveBeenCalled()
  })

  it('C3: credits when confirmed amount and currency match', async () => {
    const client = pendingClient()
    mockConnect.mockResolvedValueOnce(client as any)
    await confirmDeposit('stub-ref-001', true, undefined, { amount: 50000, currency: 'KES' })
    expect(creditDeposit).toHaveBeenCalledOnce()
  })
})
