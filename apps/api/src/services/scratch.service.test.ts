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
vi.mock('./scratch-seed.service.js', () => ({
  nextScratchRoll: vi.fn(async () => ({
    serverSeed: 'srv', serverSeedHash: 'hash', clientSeed: 'cli', nonce: 2,
  })),
}))

import { pool } from '@betting/db'
import { creditWinnings, debitBonusForBet, settleBonusWin } from './wallet.service.js'
import { getBonusMaxWinCents } from './game-settings.service.js'
import { nextScratchRoll } from './scratch-seed.service.js'
import {
  generateGridFromSeed, calculatePrize, SYMBOLS_EMOJI, buyScratchCard,
} from './scratch.service.js'

const mockConnect = vi.mocked(pool.connect)
const mockNextScratchRoll = vi.mocked(nextScratchRoll)

function makeMockClient(rows: any[][] = []) {
  let i = 0
  return {
    query: vi.fn(async () => { const r = rows[i] ?? []; i++; return { rows: r } }),
    release: vi.fn(),
  }
}

// Query sequence with nextScratchRoll/debit*/settle* mocked:
// BEGIN (idx 0), INSERT scratch_cards (idx 1), COMMIT (idx 2)
function scratchClient() {
  return makeMockClient([[], [{ id: 'card-1' }]])
}

beforeEach(() => vi.clearAllMocks())

describe('generateGridFromSeed', () => {
  it('returns exactly 9 cells', () => {
    const grid = generateGridFromSeed('server-seed', 'client-seed', 1)
    expect(grid).toHaveLength(9)
  })

  it('all cells are valid symbol indices 0-5', () => {
    const grid = generateGridFromSeed('server-seed', 'client-seed', 1)
    for (const cell of grid) {
      expect(cell).toBeGreaterThanOrEqual(0)
      expect(cell).toBeLessThanOrEqual(5)
    }
  })

  it('is deterministic for the same seed/client/nonce (player can verify)', () => {
    expect(generateGridFromSeed('srv', 'cli', 5)).toEqual(generateGridFromSeed('srv', 'cli', 5))
  })

  it('differs across nonces', () => {
    const a = generateGridFromSeed('srv', 'cli', 1)
    const b = generateGridFromSeed('srv', 'cli', 2)
    expect(a).not.toEqual(b)
  })
})

describe('calculatePrize', () => {
  it('returns 0 when no symbol appears 3+ times', () => {
    const grid = [0, 1, 2, 3, 4, 5, 0, 1, 2] // max 2 of same
    expect(calculatePrize(grid, 10000)).toBe(0)
  })

  it('returns stake * 19 for 3 matching 💎 (symbol 0)', () => {
    const grid = [0, 0, 0, 1, 2, 3, 4, 5, 5]
    expect(calculatePrize(grid, 10000)).toBe(10000 * 19)
  })

  it('returns stake * 57 for 4 matching 💎 (symbol 0)', () => {
    const grid = [0, 0, 0, 0, 1, 2, 3, 4, 5]
    expect(calculatePrize(grid, 10000)).toBe(10000 * 57)
  })

  it('returns stake * 190 for 5 matching 💎 (symbol 0)', () => {
    const grid = [0, 0, 0, 0, 0, 1, 2, 3, 4]
    expect(calculatePrize(grid, 10000)).toBe(10000 * 190)
  })

  it('returns stake * 2 for 3 matching 🔥 (symbol 3)', () => {
    const grid = [3, 3, 3, 0, 1, 2, 4, 5, 5]
    expect(calculatePrize(grid, 5000)).toBe(5000 * 2)
  })

  it('returns 0 when only ❌ matches 3+', () => {
    const grid = [5, 5, 5, 0, 1, 2, 3, 4, 1]
    expect(calculatePrize(grid, 10000)).toBe(0)
  })

  it('returns best prize when multiple symbols match 3+', () => {
    // 3x 💎 (×19) and 3x 🔥 (×2) - should return 💎 prize
    const grid = [0, 0, 0, 3, 3, 3, 1, 2, 4]
    expect(calculatePrize(grid, 10000)).toBe(10000 * 19)
  })
})

describe('SYMBOLS_EMOJI', () => {
  it('has 6 entries', () => {
    expect(SYMBOLS_EMOJI).toHaveLength(6)
  })
})

describe('buyScratchCard', () => {
  it('bonus win debits from the bonus grant and settles net via settleBonusWin, recording fund_source=bonus', async () => {
    // nonce=2 with seed 'srv'/'cli' deterministically yields grid
    // [4,4,5,5,5,5,4,5,4] -> 4x symbol 4 (💰) -> a win (stake * 4).
    const client = scratchClient()
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await buyScratchCard('p-1', 10000, 'bonus')

    expect(result.prizeCents).toBeGreaterThan(0)
    expect(debitBonusForBet).toHaveBeenCalledWith(client, 'p-1', 10000, expect.objectContaining({ game: 'scratch' }))
    expect(settleBonusWin).toHaveBeenCalledWith(
      client, 'p-1', 'g-1', result.prizeCents, 10000, 'card-1', 1_000_000,
    )
    expect(getBonusMaxWinCents).toHaveBeenCalled()
    expect(creditWinnings).not.toHaveBeenCalled()
  })

  it('bonus loss debits the bonus grant but never calls settleBonusWin', async () => {
    // nonce=0 with seed 'srv'/'cli' deterministically yields a non-winning grid.
    mockNextScratchRoll.mockResolvedValueOnce({
      serverSeed: 'srv', serverSeedHash: 'hash', clientSeed: 'cli', nonce: 0,
    })
    const client = scratchClient()
    mockConnect.mockResolvedValueOnce(client as any)

    const result = await buyScratchCard('p-1', 10000, 'bonus')

    expect(result.prizeCents).toBe(0)
    expect(debitBonusForBet).toHaveBeenCalled()
    expect(settleBonusWin).not.toHaveBeenCalled()
    expect(creditWinnings).not.toHaveBeenCalled()
  })
})
