import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: vi.fn(async (req: { adminId: string; adminRole: string }, _reply: unknown) => {
    req.adminId = 'admin-1'
    req.adminRole = 'super'
  }),
}))

vi.mock('@betting/db', () => ({
  pool: { query: vi.fn() },
}))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)

describe('GET /admin/transactions', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('returns transaction list', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'tx-1',
          type: 'bet_placed',
          amount: '10000',
          balance_after: '990000',
          created_at: '2026-04-19T14:00:00Z',
          player_name: 'Alice',
        },
      ],
    } as never)

    const res = await app.inject({
      method: 'GET',
      url: '/admin/transactions',
      headers: { Authorization: 'Bearer fake-admin-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.transactions).toHaveLength(1)
    expect(body.transactions[0].id).toBe('tx-1')
    expect(body.transactions[0].type).toBe('bet_placed')
    expect(body.transactions[0].amount).toBe(10000)
    expect(body.transactions[0].balanceAfter).toBe(990000)
    expect(body.transactions[0].playerName).toBe('Alice')
    expect(body.transactions[0].createdAt).toBeDefined()
  })
})
