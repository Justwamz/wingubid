import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@betting/db'
import { buildCriteria, playerMatchesCriteria, countMatchingPlayers } from './bonus-criteria.service.js'

const mockQuery = vi.mocked(pool.query)
beforeEach(() => mockQuery.mockReset())

describe('buildCriteria', () => {
  it('returns TRUE with no params for empty/null criteria', () => {
    expect(buildCriteria(null)).toEqual({ where: 'TRUE', params: [] })
    expect(buildCriteria({})).toEqual({ where: 'TRUE', params: [] })
  })
  it('builds registered-within-days + deposit + betting conditions', () => {
    const { where, params } = buildCriteria({ registeredWithinDays: 7, depositStatus: 'none', bettingActivity: 'has' })
    expect(where).toContain('make_interval(days =>')
    expect(where).toContain("NOT EXISTS")
    expect(where).toContain("FROM bets b")
    expect(params).toContain(7)
  })
})

describe('playerMatchesCriteria', () => {
  it('returns true for empty criteria without querying', async () => {
    expect(await playerMatchesCriteria('p1', null)).toBe(true)
    expect(mockQuery).not.toHaveBeenCalled()
  })
  it('returns the DB match result for real criteria', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ m: true }] } as never)
    expect(await playerMatchesCriteria('p1', { registeredWithinDays: 7 })).toBe(true)
  })
})

describe('countMatchingPlayers', () => {
  it('returns the count', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '42' }] } as never)
    expect(await countMatchingPlayers({ depositStatus: 'has' })).toBe(42)
  })
})
