import { describe, it, expect, vi, beforeEach } from 'vitest'
import { draw3Numbers, draw3NumbersFromSeed, countMatches, calculateLotteryPrize } from './lottery.service.js'

beforeEach(() => vi.clearAllMocks())

describe('draw3Numbers', () => {
  it('returns exactly 3 numbers', () => {
    expect(draw3Numbers()).toHaveLength(3)
  })

  it('all numbers are between 1 and 36 inclusive', () => {
    for (let i = 0; i < 20; i++) {
      const nums = draw3Numbers()
      for (const n of nums) {
        expect(n).toBeGreaterThanOrEqual(1)
        expect(n).toBeLessThanOrEqual(36)
      }
    }
  })

  it('all 3 numbers are unique', () => {
    for (let i = 0; i < 20; i++) {
      const nums = draw3Numbers()
      expect(new Set(nums).size).toBe(3)
    }
  })
})

describe('draw3NumbersFromSeed', () => {
  it('returns 3 unique numbers in [1,36]', () => {
    const nums = draw3NumbersFromSeed('some-server-seed')
    expect(nums).toHaveLength(3)
    expect(new Set(nums).size).toBe(3)
    for (const n of nums) {
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(36)
    }
  })

  it('is deterministic for the same seed (player can verify the draw)', () => {
    expect(draw3NumbersFromSeed('seed-xyz')).toEqual(draw3NumbersFromSeed('seed-xyz'))
  })

  it('differs across seeds', () => {
    expect(draw3NumbersFromSeed('seed-a')).not.toEqual(draw3NumbersFromSeed('seed-b'))
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
  it('returns ticketPrice * 100 for 3 matches on hourly', () => {
    expect(calculateLotteryPrize('hourly', 3, 2000)).toBe(200000)
  })

  it('returns ticketPrice * 5 for 2 matches on hourly', () => {
    expect(calculateLotteryPrize('hourly', 2, 2000)).toBe(10000)
  })

  it('returns ticketPrice * 1 for 1 match on hourly (break even)', () => {
    expect(calculateLotteryPrize('hourly', 1, 2000)).toBe(2000)
  })

  it('returns 0 for 0 matches', () => {
    expect(calculateLotteryPrize('hourly', 0, 2000)).toBe(0)
  })

  it('returns ticketPrice * 1000 for 3 matches on weekly', () => {
    expect(calculateLotteryPrize('weekly', 3, 50000)).toBe(50000000)
  })
})
