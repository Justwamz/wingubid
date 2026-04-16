import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'

vi.mock('../lib/jwt.js', () => ({
  verifyPlayerAccessToken: vi.fn((token: string) => {
    if (token === 'valid-token') return { sub: 'player-1', type: 'player_access' }
    throw new Error('invalid')
  }),
  verifyAdminAccessToken: vi.fn((token: string) => {
    if (token === 'valid-admin-token') return { sub: 'admin-1', role: 'finance', type: 'admin_access' }
    throw new Error('invalid')
  }),
}))

import { authenticate } from './authenticate.js'
import { authenticateAdmin } from './authenticate-admin.js'

describe('authenticate middleware', () => {
  it('sets request.playerId when token is valid', async () => {
    const app = Fastify()
    app.get('/test', { preHandler: authenticate }, async (req) => {
      return { playerId: (req as any).playerId }
    })
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer valid-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().playerId).toBe('player-1')
  })

  it('returns 401 when no token provided', async () => {
    const app = Fastify()
    app.get('/test', { preHandler: authenticate }, async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(401)
  })
})

describe('authenticateAdmin middleware', () => {
  it('sets request.adminId and request.adminRole when token is valid', async () => {
    const app = Fastify()
    app.get('/test', { preHandler: authenticateAdmin }, async (req) => ({
      adminId: (req as any).adminId,
      adminRole: (req as any).adminRole,
    }))
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { authorization: 'Bearer valid-admin-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().adminId).toBe('admin-1')
    expect(res.json().adminRole).toBe('finance')
  })
})
