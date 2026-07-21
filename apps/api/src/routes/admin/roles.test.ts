import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: vi.fn(async (req: { adminId: string }) => { req.adminId = 'admin-1' }),
}))
vi.mock('../../services/permissions.service.js', () => ({
  getPermissionsForAdmin: vi.fn(async () => ({ has: () => true })),
  invalidatePermissionsCache: vi.fn(),
}))
vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)

describe('GET /admin/permissions-catalog', () => {
  const app = buildServer()
  afterAll(() => app.close())
  it('returns the catalog', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/permissions-catalog', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().catalog.some((g: { area: string }) => g.area === 'staff')).toBe(true)
  })
})

describe('POST /admin/roles', () => {
  const app = buildServer()
  afterAll(() => app.close())
  it('rejects an unknown permission key', async () => {
    const res = await app.inject({
      method: 'POST', url: '/admin/roles', headers: { Authorization: 'Bearer t' },
      payload: { key: 'ops', name: 'Ops', description: '', permissions: ['not.a.key'] },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /admin/roles/:id', () => {
  const app = buildServer()
  afterAll(() => app.close())
  it('blocks deleting a role in use', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', key: 'ops', is_system: false }] } as never) // role
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '2' }] } as never) // assigned staff count
    const res = await app.inject({ method: 'DELETE', url: '/admin/roles/r1', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(409)
  })
})
