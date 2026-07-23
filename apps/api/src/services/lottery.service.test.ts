import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('./wallet.service.js', () => ({
  debitForBet: vi.fn(async () => ({ transactionId: 'tx', walletId: 'w' })),
  creditWinnings: vi.fn(async () => ({ transactionId: 'tx', walletId: 'w' })),
}))
vi.mock('./game-settings.service.js', () => ({
  assertGameEnabled: vi.fn(async () => {}),
}))

import { pool } from '@betting/db'
import { creditWinnings } from './wallet.service.js'
import {
  drawNumbers, drawNumbersFromSeed, countMatches, calculateLotteryPrize, settleTickets,
  buyTicket, getUpcomingDraws,
} from './lottery.service.js'

beforeEach(() => vi.clearAllMocks())

describe('drawNumbers', () => {
  it('returns exactly 6 numbers', () => {
    expect(drawNumbers()).toHaveLength(6)
  })

  it('all numbers are between 1 and 36 inclusive', () => {
    for (let i = 0; i < 20; i++) {
      const nums = drawNumbers()
      for (const n of nums) {
        expect(n).toBeGreaterThanOrEqual(1)
        expect(n).toBeLessThanOrEqual(36)
      }
    }
  })

  it('all 6 numbers are unique', () => {
    for (let i = 0; i < 20; i++) {
      const nums = drawNumbers()
      expect(new Set(nums).size).toBe(6)
    }
  })

  it('returns numbers sorted ascending', () => {
    for (let i = 0; i < 20; i++) {
      const nums = drawNumbers()
      const sorted = [...nums].sort((a, b) => a - b)
      expect(nums).toEqual(sorted)
    }
  })
})

describe('settleTickets idempotency (M4)', () => {
  const oneTicket = {
    rows: [{ id: 't1', player_id: 'p1', wallet_id: 'w1', picked_numbers: [1, 2, 3, 4, 5, 6], ticket_price: '2000' }],
  }

  it('skips the credit when the ticket was already settled (claim returns 0 rows)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce(oneTicket as any) // SELECT pending
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})              // BEGIN
        .mockResolvedValueOnce({ rowCount: 0 }) // claim UPDATE - already settled
        .mockResolvedValueOnce({}),             // COMMIT
      release: vi.fn(),
    }
    vi.mocked(pool.connect).mockResolvedValue(client as any)

    await settleTickets('draw-1', 'hourly', [1, 2, 3, 4, 5, 6])

    expect(creditWinnings).not.toHaveBeenCalled()
  })

  it('credits a winning ticket when the claim succeeds', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce(oneTicket as any)
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})              // BEGIN
        .mockResolvedValueOnce({ rowCount: 1 }) // claim UPDATE - freshly settled
        .mockResolvedValueOnce({})              // UPDATE locked_balance
        .mockResolvedValueOnce({}),             // COMMIT
      release: vi.fn(),
    }
    vi.mocked(pool.connect).mockResolvedValue(client as any)

    // picks [1..6] fully match -> hourly 6-match prize > 0 -> won
    await settleTickets('draw-1', 'hourly', [1, 2, 3, 4, 5, 6])

    expect(creditWinnings).toHaveBeenCalledOnce()
  })
})

describe('drawNumbersFromSeed', () => {
  it('returns 6 unique numbers in [1,36]', () => {
    const nums = drawNumbersFromSeed('some-server-seed')
    expect(nums).toHaveLength(6)
    expect(new Set(nums).size).toBe(6)
    for (const n of nums) {
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(36)
    }
  })

  it('is deterministic for the same seed (player can verify the draw)', () => {
    expect(drawNumbersFromSeed('seed-xyz')).toEqual(drawNumbersFromSeed('seed-xyz'))
  })

  it('differs across seeds', () => {
    expect(drawNumbersFromSeed('seed-a')).not.toEqual(drawNumbersFromSeed('seed-b'))
  })

  // Golden vector: locks the exact provable-fair derivation (HMAC-SHA256 label
  // format, byte offset/order, modulo-bias rejection, pick count) for a fixed
  // seed. If the derivation ever changes (e.g. label, offsets, or count), this
  // hard-coded expected output will fail, flagging the break instead of
  // silently producing different draws for players trying to verify a result.
  it('matches the known golden vector for a fixed seed (provable-fair lock)', () => {
    expect(drawNumbersFromSeed('golden-seed-vector-1')).toEqual([18, 24, 30, 33, 34, 36])
  })
})

describe('countMatches', () => {
  it('returns 3 when all picked numbers match winning numbers', () => {
    expect(countMatches([1, 2, 3], [1, 2, 3])).toBe(3)
  })

  it('returns 2 when 2 picked numbers match', () => {
    expect(countMatches([1, 2, 3], [1, 2, 10])).toBe(2)
  })

  it('returns 1 when 1 picked number matches', () => {
    expect(countMatches([1, 2, 3], [1, 20, 30])).toBe(1)
  })

  it('returns 0 when no numbers match', () => {
    expect(countMatches([1, 2, 3], [4, 5, 6])).toBe(0)
  })
})

describe('calculateLotteryPrize', () => {
  it('returns ticketPrice * 200000 for 6 matches on hourly', () => {
    expect(calculateLotteryPrize('hourly', 6, 2000)).toBe(400_000_000)
  })

  it('returns ticketPrice * 800 for 5 matches on hourly', () => {
    expect(calculateLotteryPrize('hourly', 5, 2000)).toBe(1_600_000)
  })

  it('returns ticketPrice * 40 for 4 matches on hourly', () => {
    expect(calculateLotteryPrize('hourly', 4, 2000)).toBe(80_000)
  })

  it('returns ticketPrice * 3 for 3 matches on hourly', () => {
    expect(calculateLotteryPrize('hourly', 3, 2000)).toBe(6_000)
  })

  it('returns 0 for 2 matches', () => {
    expect(calculateLotteryPrize('hourly', 2, 2000)).toBe(0)
  })

  it('returns 0 for 1 match', () => {
    expect(calculateLotteryPrize('hourly', 1, 2000)).toBe(0)
  })

  it('returns 0 for 0 matches', () => {
    expect(calculateLotteryPrize('hourly', 0, 2000)).toBe(0)
  })

  it('returns ticketPrice * 200000 for 6 matches on weekly', () => {
    expect(calculateLotteryPrize('weekly', 6, 50000)).toBe(10_000_000_000)
  })
})

describe('buyTicket validation', () => {
  it('rejects a pick that is not length 6', async () => {
    await expect(buyTicket('p1', 'hourly', [1, 2, 3])).rejects.toMatchObject({
      code: 'INVALID_NUMBERS',
      message: 'Please pick exactly 6 numbers.',
    })
  })

  it('rejects a pick with too many numbers', async () => {
    await expect(buyTicket('p1', 'hourly', [1, 2, 3, 4, 5, 6, 7])).rejects.toMatchObject({
      code: 'INVALID_NUMBERS',
      message: 'Please pick exactly 6 numbers.',
    })
  })

  it('rejects a pick with a number below 1', async () => {
    await expect(buyTicket('p1', 'hourly', [0, 2, 3, 4, 5, 6])).rejects.toMatchObject({
      code: 'INVALID_NUMBERS',
      message: 'Your numbers must be whole numbers between 1 and 36.',
    })
  })

  it('rejects a pick with a number above 36', async () => {
    await expect(buyTicket('p1', 'hourly', [1, 2, 3, 4, 5, 37])).rejects.toMatchObject({
      code: 'INVALID_NUMBERS',
      message: 'Your numbers must be whole numbers between 1 and 36.',
    })
  })

  it('rejects a pick with duplicate numbers', async () => {
    await expect(buyTicket('p1', 'hourly', [1, 2, 3, 4, 5, 5])).rejects.toMatchObject({
      code: 'INVALID_NUMBERS',
      message: 'Your 6 numbers must all be different.',
    })
  })
})

describe('getUpcomingDraws', () => {
  it('computes jackpot as ticketPrice * 200000', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        id: 'd1', draw_type: 'hourly', ticket_price: '2000',
        scheduled_at: '2026-01-01T00:00:00Z', server_seed_hash: 'hash1',
      }],
    } as any)

    const draws = await getUpcomingDraws()

    expect(draws).toEqual([{
      id: 'd1',
      drawType: 'hourly',
      ticketPrice: 2000,
      scheduledAt: '2026-01-01T00:00:00Z',
      jackpot: 400_000_000,
      serverSeedHash: 'hash1',
    }])
  })
})
