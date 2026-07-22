import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('./wallet.service.js', () => ({
  creditDeposit: vi.fn(async () => ({ transactionId: 'tx-1', walletId: 'w-1' })),
}))
vi.mock('../lib/phone.js', () => ({ normalizeKePhone: (p: string) => p }))
vi.mock('./deposit-match.service.js', () => ({ maybeGrantDepositMatch: vi.fn() }))

import { pool } from '@betting/db'
import { creditDeposit } from './wallet.service.js'
import { maybeGrantDepositMatch } from './deposit-match.service.js'
import { recordC2bPayment } from './c2b.service.js'

const mockConnect = vi.mocked(pool.connect)

// Mock client whose query() returns the queued rows in call order.
function makeMockClient(rows: any[][] = []) {
  let i = 0
  return {
    query: vi.fn(async () => { const r = rows[i] ?? []; i++; return { rows: r, rowCount: (rows[i - 1] ?? []).length } }),
    release: vi.fn(),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('recordC2bPayment', () => {
  it('credits the wallet when the paying number matches a user', async () => {
    // BEGIN, dup-check (none), players (match), INSERT, COMMIT
    const client = makeMockClient([[], [], [{ id: 'p-1' }], [], []])
    mockConnect.mockResolvedValueOnce(client as any)

    const res = await recordC2bPayment({ msisdn: '+254712000111', amount: 5000, mpesaReceipt: 'RCPT1' })

    expect(res).toEqual({ status: 'credited', playerId: 'p-1' })
    expect(creditDeposit).toHaveBeenCalledWith(client, 'p-1', 5000, 'c2b:RCPT1', expect.any(Object))
    expect(maybeGrantDepositMatch).toHaveBeenCalledWith('p-1', 5000)
  })

  it('holds the payment as unresolved when no user matches', async () => {
    // BEGIN, dup-check (none), players (none), INSERT, COMMIT
    const client = makeMockClient([[], [], [], [], []])
    mockConnect.mockResolvedValueOnce(client as any)

    const res = await recordC2bPayment({ msisdn: '+254799999999', amount: 5000, mpesaReceipt: 'RCPT2' })

    expect(res).toEqual({ status: 'unresolved' })
    expect(creditDeposit).not.toHaveBeenCalled()
    expect(maybeGrantDepositMatch).not.toHaveBeenCalled()
  })

  it('is idempotent: a duplicate receipt does not credit again', async () => {
    // BEGIN, dup-check finds an existing row, COMMIT
    const client = makeMockClient([[], [{ status: 'credited' }], []])
    mockConnect.mockResolvedValueOnce(client as any)

    const res = await recordC2bPayment({ msisdn: '+254712000111', amount: 5000, mpesaReceipt: 'RCPT1' })

    expect(res).toEqual({ status: 'credited', duplicate: true })
    expect(creditDeposit).not.toHaveBeenCalled()
    expect(maybeGrantDepositMatch).not.toHaveBeenCalled()
  })

  it('rejects a non-positive amount', async () => {
    await expect(recordC2bPayment({ msisdn: '+254712000111', amount: 0, mpesaReceipt: 'X' }))
      .rejects.toMatchObject({ code: 'INVALID_AMOUNT' })
  })
})
