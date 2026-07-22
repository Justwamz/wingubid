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
vi.mock('../../services/bonus-eligibility.service.js', () => ({
  evaluateBonusEligibility: vi.fn(async () => ({ flags: [] })),
}))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'
import { evaluateBonusEligibility } from '../../services/bonus-eligibility.service.js'

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

  it('grants a bonus by phone number', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PLAYER_ID }] } as never)  // player resolved by phone
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)                    // no active grant
    mockConnect.mockResolvedValueOnce(fakeClient((sql) => {
      if (sql.includes('SELECT id, balance')) return { rows: [{ id: 'w1', balance: '0', currency: 'KES' }] }
      if (sql.includes('INSERT INTO bonus_grants')) return { rows: [{ id: 'g2' }] }
      if (sql.startsWith('UPDATE wallets')) return { rows: [{ bonus_balance: '50000' }] }
      return { rows: [] }
    }) as never)
    const res = await app.inject({ method: 'POST', url: '/admin/bonuses/grant', headers: { Authorization: 'Bearer t' },
      payload: { phone: '+254700000001', amountCents: 50000 } })
    expect(res.statusCode).toBe(200)
    expect(res.json().grantId).toBe('g2')
  })

  it('404 when no player has that phone', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)  // phone lookup finds nobody
    const res = await app.inject({ method: 'POST', url: '/admin/bonuses/grant', headers: { Authorization: 'Bearer t' },
      payload: { phone: '+254700000999', amountCents: 50000 } })
    expect(res.statusCode).toBe(404)
  })

  it('400 when neither phone nor playerId is provided', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/bonuses/grant', headers: { Authorization: 'Bearer t' },
      payload: { amountCents: 50000 } })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /admin/bonuses/eligibility', () => {
  const app = buildServer(); afterAll(() => app.close())
  it('returns flags for a player looked up by phone', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PLAYER_ID }] } as never) // player by phone
    vi.mocked(evaluateBonusEligibility).mockResolvedValueOnce({ flags: [{ type: 'ip_velocity', severity: 'warn', message: '3 accounts share this IP.', count: 3 }] })
    const res = await app.inject({ method: 'GET', url: '/admin/bonuses/eligibility?phone=%2B254700000001', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().flags[0].type).toBe('ip_velocity')
  })

  it('400s on a malformed playerId instead of 500ing', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/bonuses/eligibility?playerId=abc', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('400s when neither phone nor playerId is provided', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/bonuses/eligibility', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /admin/bonuses/grant abuse enforcement', () => {
  const app = buildServer(); afterAll(() => app.close())
  it('blocks 409 ABUSE_BLOCKED on a block flag without override', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PLAYER_ID }] } as never) // player exists
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)                    // no active grant
    vi.mocked(evaluateBonusEligibility).mockResolvedValueOnce({ flags: [{ type: 'ip_velocity', severity: 'block', message: 'blocked', count: 9 }] })
    const res = await app.inject({ method: 'POST', url: '/admin/bonuses/grant', headers: { Authorization: 'Bearer t' },
      payload: { phone: '+254700000001', amountCents: 50000 } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('ABUSE_BLOCKED')
  })

  it('allows the grant with override:true despite a block flag', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PLAYER_ID }] } as never) // player exists
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)                    // no active grant
    vi.mocked(evaluateBonusEligibility).mockResolvedValueOnce({ flags: [{ type: 'ip_velocity', severity: 'block', message: 'blocked', count: 9 }] })
    mockConnect.mockResolvedValueOnce(fakeClient((sql) => {
      if (sql.includes('SELECT id, balance')) return { rows: [{ id: 'w1', balance: '0', currency: 'KES' }] }
      if (sql.includes('INSERT INTO bonus_grants')) return { rows: [{ id: 'g9' }] }
      if (sql.startsWith('UPDATE wallets')) return { rows: [{ bonus_balance: '50000' }] }
      return { rows: [] }
    }) as never)
    const res = await app.inject({ method: 'POST', url: '/admin/bonuses/grant', headers: { Authorization: 'Bearer t' },
      payload: { phone: '+254700000001', amountCents: 50000, override: true } })
    expect(res.statusCode).toBe(200)
    expect(res.json().grantId).toBe('g9')
  })
})
