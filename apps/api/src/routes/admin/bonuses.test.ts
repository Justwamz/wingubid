import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: vi.fn(async (req: { adminId: string }) => { req.adminId = 'admin-1' }),
}))
vi.mock('../../services/permissions.service.js', () => ({
  getPermissionsForAdmin: vi.fn(async () => ({ has: () => true })),
  invalidatePermissionsCache: vi.fn(),
}))
vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('../../services/game-settings.service.js', () => ({
  getBonusDefaultExpiryDays: vi.fn(async () => 30),
}))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)
const mockConnect = vi.mocked(pool.connect)

// Brief's fixture used a bare 'p1' playerId, but the route's zod schema
// requires a UUID (`z.string().uuid()`). A non-UUID playerId fails validation
// before ever reaching the mocked pool/client calls, so the "grants" and
// "rejects active grant" tests below would never exercise their intended
// path. Fixed minimally by using a valid UUID for playerId in those two tests.
const PLAYER_ID = '11111111-1111-1111-1111-111111111111'

function fakeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[] }) {
  return { query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)), release: vi.fn() }
}

describe('POST /admin/bonuses/grant', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('grants a bonus to a player with no active grant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] } as never)          // player exists
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)                       // no active grant
    mockConnect.mockResolvedValueOnce(fakeClient((sql) => {
      if (sql.includes('SELECT id, balance')) return { rows: [{ id: 'w1', balance: '0', currency: 'KES' }] }
      if (sql.includes('INSERT INTO bonus_grants')) return { rows: [{ id: 'g1' }] }
      if (sql.startsWith('UPDATE wallets')) return { rows: [{ bonus_balance: '50000' }] }
      return { rows: [] }
    }) as never)
    const res = await app.inject({ method: 'POST', url: '/admin/bonuses/grant', headers: { Authorization: 'Bearer t' },
      payload: { playerId: PLAYER_ID, amountCents: 50000 } })
    expect(res.statusCode).toBe(200)
    expect(res.json().grantId).toBe('g1')
  })

  it('rejects when the player already has an active grant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] } as never)  // player exists
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'g0' }] } as never)  // active grant exists
    const res = await app.inject({ method: 'POST', url: '/admin/bonuses/grant', headers: { Authorization: 'Bearer t' },
      payload: { playerId: PLAYER_ID, amountCents: 50000 } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('ACTIVE_BONUS_EXISTS')
  })

  it('rejects a non-positive amount', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/bonuses/grant', headers: { Authorization: 'Bearer t' },
      payload: { playerId: PLAYER_ID, amountCents: 0 } })
    expect(res.statusCode).toBe(400)
  })
})
