import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))
vi.mock('../../services/admin-auth.service.js', () => ({
  loginAdmin: vi.fn(),
  logoutAdmin: vi.fn(),
}))

import { buildServer } from '../../server.js'
import * as adminAuthService from '../../services/admin-auth.service.js'

const mockLoginAdmin = vi.mocked(adminAuthService.loginAdmin)

describe('rate limiting', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('returns 429 TOO_MANY_REQUESTS on the 11th /admin/auth/login request from the same IP within the window', async () => {
    mockLoginAdmin.mockResolvedValue({
      accessToken: 'tok',
      refreshToken: 'ref',
      admin: { id: 'a1', email: 'admin@example.com' },
      mustChangePassword: false,
    } as never)

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/auth/login',
        headers: { 'x-forwarded-for': '203.0.113.12' },
        payload: { email: 'admin@example.com', password: 'Password1!' },
      })
      expect(res.statusCode).toBe(200)
    }

    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      headers: { 'x-forwarded-for': '203.0.113.12' },
      payload: { email: 'admin@example.com', password: 'Password1!' },
    })
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe('TOO_MANY_REQUESTS')
  })
})
