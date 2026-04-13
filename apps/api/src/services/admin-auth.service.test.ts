import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))
vi.mock('../lib/hash.js', () => ({
  verifyPassword: vi.fn(async (plain: string, hash: string) => hash === `hash:${plain}`),
}))
vi.mock('../lib/jwt.js', () => ({
  signAdminAccessToken: vi.fn((id: string, role: string) => `admin-access:${id}:${role}`),
}))

import { pool } from '@betting/db'
import { loginAdmin } from './admin-auth.service.js'

const mockQuery = vi.mocked(pool.query)

beforeEach(() => mockQuery.mockReset())

describe('loginAdmin', () => {
  it('returns tokens for valid credentials', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'admin-1',
        role: 'finance',
        status: 'active',
        password_hash: 'hash:AdminPass1!',
        name: 'Finance User',
        email: 'finance@example.com',
      }],
    } as any)
    mockQuery.mockResolvedValueOnce({ rows: [] } as any) // insert refresh token

    const result = await loginAdmin('finance@example.com', 'AdminPass1!')
    expect(result.accessToken).toBe('admin-access:admin-1:finance')
    expect(result.admin.role).toBe('finance')
  })

  it('throws INVALID_CREDENTIALS for unknown email', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    await expect(loginAdmin('x@x.com', 'pass')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    })
  })

  it('throws INVALID_CREDENTIALS for wrong password', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'admin-1',
        role: 'finance',
        status: 'active',
        password_hash: 'hash:correct',
        name: 'Finance User',
        email: 'finance@example.com',
      }],
    } as any)
    await expect(loginAdmin('finance@example.com', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    })
  })
})
