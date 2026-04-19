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

vi.mock('../../lib/hash.js', () => ({
  hashPassword: vi.fn(async (plain: string) => `hashed_${plain}`),
}))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)

describe('GET /admin/players', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('returns player list', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'uuid-1',
          name: 'Alice',
          phone: '+254700000001',
          country: 'KE',
          balance: 150000,
          created_at: '2026-04-01T10:00:00Z',
        },
      ],
    } as never)

    const res = await app.inject({
      method: 'GET',
      url: '/admin/players',
      headers: { Authorization: 'Bearer fake-admin-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.players).toHaveLength(1)
    expect(body.players[0].id).toBe('uuid-1')
    expect(body.players[0].phone).toBe('+254700000001')
  })
})

describe('POST /admin/players/:id/reset-password', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('returns tempPassword when player exists', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'uuid-1', phone: '+254700000001', name: 'Alice' }],
    } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    const res = await app.inject({
      method: 'POST',
      url: '/admin/players/uuid-1/reset-password',
      headers: { Authorization: 'Bearer fake-admin-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.tempPassword).toBeDefined()
    expect(typeof body.tempPassword).toBe('string')
    expect(body.tempPassword.length).toBe(8)
  })

  it('returns 404 when player not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    const res = await app.inject({
      method: 'POST',
      url: '/admin/players/nonexistent-id/reset-password',
      headers: { Authorization: 'Bearer fake-admin-token' },
    })

    expect(res.statusCode).toBe(404)
  })
})
