import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateGridFromSeed, calculatePrize, SYMBOLS_EMOJI } from './scratch.service.js'

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
    // 3x 💎 (×19) and 3x 🔥 (×2) — should return 💎 prize
    const grid = [0, 0, 0, 3, 3, 3, 1, 2, 4]
    expect(calculatePrize(grid, 10000)).toBe(10000 * 19)
  })
})

describe('SYMBOLS_EMOJI', () => {
  it('has 6 entries', () => {
    expect(SYMBOLS_EMOJI).toHaveLength(6)
  })
})
