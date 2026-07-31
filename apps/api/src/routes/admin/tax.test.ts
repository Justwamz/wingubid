import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: vi.fn(async (req: { adminId: string }) => { req.adminId = 'admin-1' }),
}))
vi.mock('../../services/permissions.service.js', () => ({
  getPermissionsForAdmin: vi.fn(async () => new Set(['taxes.view', 'taxes.edit'])),
  invalidatePermissionsCache: vi.fn(),
}))
vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'
import { getPermissionsForAdmin } from '../../services/permissions.service.js'

const mockQuery = vi.mocked(pool.query)
const mockGetPermissions = vi.mocked(getPermissionsForAdmin)

describe('GET /admin/tax-rules', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('returns rules mapped from rows when the admin has taxes.view', async () => {
    mockGetPermissions.mockResolvedValueOnce(new Set(['taxes.view']))
    mockQuery.mockResolvedValueOnce({ rows: [
      { country: 'KE', tax_type: 'wager_tax', rate: '12.50', enabled: true },
      { country: 'KE', tax_type: 'withdrawal_tax', rate: '20.00', enabled: true },
    ] } as never)
    const res = await app.inject({ method: 'GET', url: '/admin/tax-rules', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().rules).toEqual([
      { country: 'KE', taxType: 'wager_tax', rate: 12.5, enabled: true },
      { country: 'KE', taxType: 'withdrawal_tax', rate: 20, enabled: true },
    ])
  })

  it('403s when the admin lacks taxes.view', async () => {
    mockGetPermissions.mockResolvedValueOnce(new Set(['taxes.edit']))
    const res = await app.inject({ method: 'GET', url: '/admin/tax-rules', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(403)
  })
})

describe('PUT /admin/tax-rules', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('upserts a rule when the admin has taxes.edit', async () => {
    mockGetPermissions.mockResolvedValueOnce(new Set(['taxes.edit']))
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = await app.inject({ method: 'PUT', url: '/admin/tax-rules', headers: { Authorization: 'Bearer t' },
      payload: { country: 'KE', taxType: 'wager_tax', rate: 15, enabled: true } })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tax_rules (country, tax_type, rate, enabled, updated_at, updated_by)'),
      ['KE', 'wager_tax', 15, true, 'admin-1'],
    )
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('updated_at = NOW(), updated_by = EXCLUDED.updated_by'),
      ['KE', 'wager_tax', 15, true, 'admin-1'],
    )
  })

  it('403s when the admin lacks taxes.edit', async () => {
    mockGetPermissions.mockResolvedValueOnce(new Set(['taxes.view']))
    mockQuery.mockClear()
    const res = await app.inject({ method: 'PUT', url: '/admin/tax-rules', headers: { Authorization: 'Bearer t' },
      payload: { country: 'KE', taxType: 'wager_tax', rate: 15, enabled: true } })
    expect(res.statusCode).toBe(403)
    for (const call of mockQuery.mock.calls) {
      expect(String(call[0])).not.toContain('INSERT INTO tax_rules')
    }
  })

  it('400s on an invalid country', async () => {
    mockGetPermissions.mockResolvedValueOnce(new Set(['taxes.edit']))
    const res = await app.inject({ method: 'PUT', url: '/admin/tax-rules', headers: { Authorization: 'Bearer t' },
      payload: { country: 'US', taxType: 'wager_tax', rate: 15, enabled: true } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('400s on an invalid taxType', async () => {
    mockGetPermissions.mockResolvedValueOnce(new Set(['taxes.edit']))
    const res = await app.inject({ method: 'PUT', url: '/admin/tax-rules', headers: { Authorization: 'Bearer t' },
      payload: { country: 'KE', taxType: 'income_tax', rate: 15, enabled: true } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('400s on a rate above 100', async () => {
    mockGetPermissions.mockResolvedValueOnce(new Set(['taxes.edit']))
    const res = await app.inject({ method: 'PUT', url: '/admin/tax-rules', headers: { Authorization: 'Bearer t' },
      payload: { country: 'KE', taxType: 'wager_tax', rate: 150, enabled: true } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('400s on a negative rate', async () => {
    mockGetPermissions.mockResolvedValueOnce(new Set(['taxes.edit']))
    const res = await app.inject({ method: 'PUT', url: '/admin/tax-rules', headers: { Authorization: 'Bearer t' },
      payload: { country: 'KE', taxType: 'wager_tax', rate: -1, enabled: true } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('400s on a rate with more than 2 decimal places', async () => {
    mockGetPermissions.mockResolvedValueOnce(new Set(['taxes.edit']))
    const res = await app.inject({ method: 'PUT', url: '/admin/tax-rules', headers: { Authorization: 'Bearer t' },
      payload: { country: 'KE', taxType: 'wager_tax', rate: 12.345, enabled: true } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('400s on a non-boolean enabled', async () => {
    mockGetPermissions.mockResolvedValueOnce(new Set(['taxes.edit']))
    const res = await app.inject({ method: 'PUT', url: '/admin/tax-rules', headers: { Authorization: 'Bearer t' },
      payload: { country: 'KE', taxType: 'wager_tax', rate: 15, enabled: 'yes' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })
})
