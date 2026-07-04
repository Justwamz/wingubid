import { describe, it, expect } from 'vitest'
import { generateCrashPoint, generateMinePositions, rollDiceResult } from './crash-rng.js'

const SERVER = 'test-server-seed-fixed-value-for-tests'
const CLIENT = 'test-client-seed'

describe('generateCrashPoint', () => {
  it('returns a number >= 1.00', () => {
    expect(generateCrashPoint(SERVER, CLIENT, 1, 5)).toBeGreaterThanOrEqual(1.00)
  })

  it('is deterministic', () => {
    expect(generateCrashPoint(SERVER, CLIENT, 42, 5)).toBe(generateCrashPoint(SERVER, CLIENT, 42, 5))
  })

  it('produces variety across round numbers', () => {
    const values = new Set(Array.from({ length: 30 }, (_, i) => generateCrashPoint(SERVER, CLIENT, i, 5)))
    expect(values.size).toBeGreaterThan(5)
  })

  it('realizes the configured house edge (single-source, no double-counting)', () => {
    // Deterministic Monte Carlo over fixed round numbers: bet 1, auto-cashout
    // at 2x. Expected RTP = 1 - edge/100 = 0.95. If a second edge were stacked
    // on top (e.g. a separate instant-crash branch) RTP would fall well below
    // 0.93. Bounds are wide enough that this is stable, not flaky.
    const N = 50000
    let payout = 0
    for (let r = 1; r <= N; r++) {
      if (generateCrashPoint(SERVER, CLIENT, r, 5) >= 2.0) payout += 2.0
    }
    const rtp = payout / N
    expect(rtp).toBeGreaterThan(0.93)
    expect(rtp).toBeLessThan(0.97)
  })
})

describe('generateMinePositions', () => {
  it('returns exactly mineCount positions', () => {
    expect(generateMinePositions(SERVER, CLIENT, 'g1', 9, 3)).toHaveLength(3)
  })

  it('all positions are within [0, totalTiles-1]', () => {
    const pos = generateMinePositions(SERVER, CLIENT, 'g1', 25, 5)
    for (const p of pos) {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(25)
    }
  })

  it('positions are sorted ascending', () => {
    const pos = generateMinePositions(SERVER, CLIENT, 'g1', 25, 5)
    for (let i = 1; i < pos.length; i++) expect(pos[i]).toBeGreaterThan(pos[i - 1])
  })

  it('is deterministic', () => {
    expect(generateMinePositions(SERVER, CLIENT, 'gx', 9, 2))
      .toEqual(generateMinePositions(SERVER, CLIENT, 'gx', 9, 2))
  })
})

describe('rollDiceResult', () => {
  it('returns value in [0, 99]', () => {
    const r = rollDiceResult(SERVER, CLIENT, 1)
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThan(100)
  })

  it('is deterministic', () => {
    expect(rollDiceResult(SERVER, CLIENT, 7)).toBe(rollDiceResult(SERVER, CLIENT, 7))
  })
})
