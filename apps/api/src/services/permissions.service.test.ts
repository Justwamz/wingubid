import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@betting/db'
import { getPermissionsForAdmin, invalidatePermissionsCache } from './permissions.service.js'
import { ALL_PERMISSION_KEYS } from '../lib/permissions.js'

const mockQuery = vi.mocked(pool.query)

describe('getPermissionsForAdmin', () => {
  beforeEach(() => { mockQuery.mockReset(); invalidatePermissionsCache() })

  it('returns the role grants for a normal role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role_key: 'finance', status: 'active', perms: ['stats.view', 'withdrawals.view'] }] } as never)
    const set = await getPermissionsForAdmin('a1')
    expect(set.has('stats.view')).toBe(true)
    expect(set.has('withdrawals.approve')).toBe(false)
  })

  it('gives super_admin every catalog key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role_key: 'super_admin', status: 'active', perms: [] }] } as never)
    const set = await getPermissionsForAdmin('a2')
    for (const k of ALL_PERMISSION_KEYS) expect(set.has(k)).toBe(true)
  })

  it('caches: a second call within TTL does not re-query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role_key: 'support', status: 'active', perms: ['stats.view'] }] } as never)
    await getPermissionsForAdmin('a3')
    await getPermissionsForAdmin('a3')
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('returns an empty set when the admin has no role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const set = await getPermissionsForAdmin('a4')
    expect(set.size).toBe(0)
  })

  it('returns an empty set for a suspended admin, even super_admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role_key: 'super_admin', status: 'suspended', perms: [] }] } as never)
    const set = await getPermissionsForAdmin('a5')
    expect(set.size).toBe(0)
  })
})
