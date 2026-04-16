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
