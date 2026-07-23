import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticate.js', () => ({
  authenticate: vi.fn(async (req: { playerId: string }) => { req.playerId = 'p1' }),
}))

vi.mock('@betting/db', () => ({
  pool: { query: vi.fn() },
}))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)

describe('GET /games/history/all', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('reports net credited (not gross prize) for a bonus-funded scratch card, and returns fundSource', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'sc-1',
          game: 'scratch',
          stake: '5000',
          multiplier: null,
          payout: 2000, // net_credited_cents, lower than prize_cents (10000)
          status: 'won',
          created_at: '2026-07-01T00:00:00Z',
          fund_source: 'bonus',
        },
      ],
    } as never)

    const res = await app.inject({
      method: 'GET',
      url: '/games/history/all',
      headers: { Authorization: 'Bearer t' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0].payout).toBe(2000)
    expect(body[0].fundSource).toBe('bonus')
  })
})
