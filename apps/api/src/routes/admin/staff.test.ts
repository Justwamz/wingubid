import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: vi.fn(async (req: { adminId: string }) => { req.adminId = 'admin-1' }),
}))
vi.mock('../../services/permissions.service.js', () => ({
  getPermissionsForAdmin: vi.fn(async () => ({ has: () => true })),
  invalidatePermissionsCache: vi.fn(),
}))
vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))
vi.mock('../../lib/hash.js', () => ({ hashPassword: vi.fn(async (p: string) => `hashed_${p}`) }))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'
import { getPermissionsForAdmin } from '../../services/permissions.service.js'

const mockQuery = vi.mocked(pool.query)

describe('GET /admin/staff', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('lists staff', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 'u1', name: 'Jane', email: 'jane@x.com', role_name: 'Finance', role_id: 'r1', status: 'active', auth_provider: 'local', last_login_at: null },
    ] } as never)
    const res = await app.inject({ method: 'GET', url: '/admin/staff', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().staff).toHaveLength(1)
  })
})

describe('POST /admin/staff', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('creates a staff member', async () => {
    // role lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', key: 'finance' }] } as never)
    // target role permission keys (escalation check)
    mockQuery.mockResolvedValueOnce({ rows: [{ permission_key: 'stats.view' }] } as never)
    // insert
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'new-1' }] } as never)
    // audit
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = await app.inject({
      method: 'POST', url: '/admin/staff', headers: { Authorization: 'Bearer t' },
      // roleId must be a UUID to pass the route's zod schema; the mocked pool
      // returns fixed rows regardless of the value sent.
      payload: { name: 'Otis', email: 'otis@x.com', roleId: '11111111-1111-1111-1111-111111111111', password: 'temp1234' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe('new-1')
  })

  it('rejects assigning a role that grants perms the caller lacks', async () => {
    // Caller only holds staff.create; the middleware gate and the route
    // escalation check both read the same limited set.
    vi.mocked(getPermissionsForAdmin)
      .mockResolvedValueOnce(new Set(['staff.create']))
      .mockResolvedValueOnce(new Set(['staff.create']))
    // role lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', key: 'finance' }] } as never)
    // target role grants a broader permission the caller does not hold
    mockQuery.mockResolvedValueOnce({ rows: [{ permission_key: 'withdrawals.approve' }] } as never)
    const res = await app.inject({
      method: 'POST', url: '/admin/staff', headers: { Authorization: 'Bearer t' },
      payload: { name: 'Otis', email: 'otis@x.com', roleId: '11111111-1111-1111-1111-111111111111', password: 'temp1234' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('INSUFFICIENT_PRIVILEGE')
  })

  it('rejects a short password', async () => {
    const res = await app.inject({
      method: 'POST', url: '/admin/staff', headers: { Authorization: 'Bearer t' },
      payload: { name: 'Otis', email: 'otis@x.com', roleId: 'r1', password: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PUT /admin/staff/:id/status guardrail', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('blocks suspending the last active super admin', async () => {
    // target row: super_admin + active
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', role_key: 'super_admin', status: 'active' }] } as never)
    // count of OTHER active super admins = 0
    mockQuery.mockResolvedValueOnce({ rows: [{ n: '0' }] } as never)
    const res = await app.inject({
      method: 'PUT', url: '/admin/staff/u1/status', headers: { Authorization: 'Bearer t' },
      payload: { status: 'suspended' },
    })
    expect(res.statusCode).toBe(409)
  })
})
