import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: vi.fn(async (req: { adminId: string; adminRole: string }) => { req.adminId = 'admin-1'; req.adminRole = 'super_admin' }),
}))
vi.mock('../../services/permissions.service.js', () => ({
  getPermissionsForAdmin: vi.fn(async () => new Set(['stats.view', 'staff.view'])),
  invalidatePermissionsCache: vi.fn(),
}))
vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))
vi.mock('../../lib/hash.js', () => ({ hashPassword: vi.fn(async (p: string) => `hashed_${p}`), verifyPassword: vi.fn(async () => true) }))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)

describe('GET /admin/me', () => {
  const app = buildServer()
  afterAll(() => app.close())
  it('returns profile + permissions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'admin-1', name: 'Boss', email: 'boss@x.com', role_name: 'Super Admin' }] } as never)
    const res = await app.inject({ method: 'GET', url: '/admin/me', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().permissions).toContain('staff.view')
  })
})

describe('POST /admin/change-password', () => {
  const app = buildServer()
  afterAll(() => app.close())
  it('changes the password and clears must_change', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: 'h' }] } as never) // load
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // update
    const res = await app.inject({
      method: 'POST', url: '/admin/change-password', headers: { Authorization: 'Bearer t' },
      payload: { currentPassword: 'old', newPassword: 'newpass123' },
    })
    expect(res.statusCode).toBe(200)
  })
})
