import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: vi.fn(async (req: { adminId: string }) => { req.adminId = 'admin-1' }),
}))
vi.mock('../../services/permissions.service.js', () => ({
  getPermissionsForAdmin: vi.fn(async () => ({ has: () => true })),
  invalidatePermissionsCache: vi.fn(),
}))
vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('../../services/bonus-criteria.service.js', async (orig) => ({
  ...(await orig()),
  countMatchingPlayers: vi.fn(async () => 42),
}))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)

const CAMPAIGN_ID = '22222222-2222-2222-2222-222222222222'

describe('GET /admin/campaigns', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('lists campaigns with claim counts', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CAMPAIGN_ID, key: 'welcome_2026', name: 'Welcome Bonus', claim_count: '3' }] } as never)
    const res = await app.inject({ method: 'GET', url: '/admin/campaigns', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().campaigns).toHaveLength(1)
    expect(res.json().campaigns[0].claim_count).toBe('3')
  })
})

describe('POST /admin/campaigns', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('creates a campaign and returns its id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CAMPAIGN_ID }] } as never) // insert
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // audit
    const res = await app.inject({ method: 'POST', url: '/admin/campaigns', headers: { Authorization: 'Bearer t' },
      payload: { key: 'welcome_2026', name: 'Welcome Bonus', type: 'welcome', amountCents: 50000 } })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(CAMPAIGN_ID)
  })

  it('rejects a non-positive amount', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/campaigns', headers: { Authorization: 'Bearer t' },
      payload: { key: 'welcome_2026', name: 'Welcome Bonus', type: 'welcome', amountCents: 0 } })
    expect(res.statusCode).toBe(400)
  })

  it('409s on a duplicate campaign key', async () => {
    mockQuery.mockRejectedValueOnce({ code: '23505' } as never)
    const res = await app.inject({ method: 'POST', url: '/admin/campaigns', headers: { Authorization: 'Bearer t' },
      payload: { key: 'welcome_2026', name: 'Welcome Bonus', type: 'welcome', amountCents: 50000 } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('CAMPAIGN_KEY_TAKEN')
  })

  it('creates a campaign with a code and returns its id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CAMPAIGN_ID }] } as never) // insert
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // audit
    const res = await app.inject({ method: 'POST', url: '/admin/campaigns', headers: { Authorization: 'Bearer t' },
      payload: { key: 'welcome_2026', name: 'Welcome Bonus', type: 'welcome', amountCents: 50000, code: 'welcome10' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(CAMPAIGN_ID)
  })

  it('409s CODE_TAKEN on a duplicate campaign code', async () => {
    mockQuery.mockRejectedValueOnce({ code: '23505', constraint: 'uq_bonus_campaigns_code' } as never)
    const res = await app.inject({ method: 'POST', url: '/admin/campaigns', headers: { Authorization: 'Bearer t' },
      payload: { key: 'welcome_2026', name: 'Welcome Bonus', type: 'welcome', amountCents: 50000, code: 'welcome10' } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('CODE_TAKEN')
  })
})

describe('POST /admin/campaigns/preview-count', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('returns the count of matching players', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/campaigns/preview-count', headers: { Authorization: 'Bearer t' },
      payload: { criteria: { depositStatus: 'none' } } })
    expect(res.statusCode).toBe(200)
    expect(res.json().count).toBe(42)
  })
})

describe('PUT /admin/campaigns/:id/status', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('updates the campaign status', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never) // update
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // audit
    const res = await app.inject({ method: 'PUT', url: `/admin/campaigns/${CAMPAIGN_ID}/status`, headers: { Authorization: 'Bearer t' },
      payload: { status: 'paused' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('404s when the campaign does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 } as never)
    const res = await app.inject({ method: 'PUT', url: `/admin/campaigns/${CAMPAIGN_ID}/status`, headers: { Authorization: 'Bearer t' },
      payload: { status: 'paused' } })
    expect(res.statusCode).toBe(404)
  })

  it('400s on an invalid status', async () => {
    const res = await app.inject({ method: 'PUT', url: `/admin/campaigns/${CAMPAIGN_ID}/status`, headers: { Authorization: 'Bearer t' },
      payload: { status: 'bogus' } })
    expect(res.statusCode).toBe(400)
  })
})
