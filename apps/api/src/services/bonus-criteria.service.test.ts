import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@betting/db'
import { buildCriteria, playerMatchesCriteria, countMatchingPlayers } from './bonus-criteria.service.js'

const mockQuery = vi.mocked(pool.query)
beforeEach(() => mockQuery.mockReset())

describe('buildCriteria', () => {
  it('returns pl.status = active with no params for empty/null criteria', () => {
    expect(buildCriteria(null)).toEqual({ where: "pl.status = 'active'", params: [] })
    expect(buildCriteria({})).toEqual({ where: "pl.status = 'active'", params: [] })
  })
  it('builds registered-within-days + deposit + betting conditions after the active-status base', () => {
    const { where, params } = buildCriteria({ registeredWithinDays: 7, depositStatus: 'none', bettingActivity: 'has' })
    expect(where.startsWith("pl.status = 'active' AND")).toBe(true)
    expect(where).toContain('make_interval(days =>')
    expect(where).toContain("NOT EXISTS")
    expect(where).toContain("FROM bets b")
    expect(params).toContain(7)
  })
})

describe('playerMatchesCriteria', () => {
  it('returns true for empty criteria for an active player', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ m: true }] } as never)
    expect(await playerMatchesCriteria('p1', null)).toBe(true)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql] = mockQuery.mock.calls[0]
    expect(sql).toContain("pl.status = 'active'")
  })
  it('returns false for empty criteria for a non-active player', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ m: false }] } as never)
    expect(await playerMatchesCriteria('p1', null)).toBe(false)
  })
  it('returns the DB match result for real criteria', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ m: true }] } as never)
    expect(await playerMatchesCriteria('p1', { registeredWithinDays: 7 })).toBe(true)
  })
  it('returns false for a non-active player even when other criteria would match', async () => {
    // The EXISTS query itself enforces pl.status = 'active', so a non-active player
    // never satisfies the fragment regardless of other conditions - simulate the DB saying no match.
    mockQuery.mockResolvedValueOnce({ rows: [{ m: false }] } as never)
    expect(await playerMatchesCriteria('p1', { depositStatus: 'has' })).toBe(false)
    const [sql] = mockQuery.mock.calls[0]
    expect(sql).toContain("pl.status = 'active' AND")
  })
})

describe('countMatchingPlayers', () => {
  it('returns the count', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '42' }] } as never)
    expect(await countMatchingPlayers({ depositStatus: 'has' })).toBe(42)
  })
  it('with no criteria counts active players only', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '10' }] } as never)
    expect(await countMatchingPlayers(null)).toBe(10)
    const [sql] = mockQuery.mock.calls[0]
    expect(sql).toContain("pl.status = 'active'")
  })
})
