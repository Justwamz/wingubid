import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticateAdmin.js', () => ({
  authenticateAdmin: vi.fn(async (req: { adminId: string }) => { req.adminId = 'admin-1' }),
}))
vi.mock('../../services/permissions.service.js', () => ({
  getPermissionsForAdmin: vi.fn(async () => ({ has: () => true })),
  invalidatePermissionsCache: vi.fn(),
}))
vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)

const BANNER_ID = '33333333-3333-3333-3333-333333333333'
const CAMPAIGN_ID = '44444444-4444-4444-4444-444444444444'

describe('GET /admin/banners', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('returns campaignId and campaignName from the join', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: BANNER_ID, placement: 'landing', headline: 'Hi', subtext: '', cta_text: '', cta_url: '',
      image_url: '', gradient: '', active: true, created_at: new Date(), campaign_id: CAMPAIGN_ID,
      campaign_name: 'Welcome Bonus',
    }] } as never)
    const res = await app.inject({ method: 'GET', url: '/admin/banners', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    const banner = res.json().banners[0]
    expect(banner.campaignId).toBe(CAMPAIGN_ID)
    expect(banner.campaignName).toBe('Welcome Bonus')
  })
})

describe('GET /admin/banners/campaign-options', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('returns active campaigns', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CAMPAIGN_ID, name: 'Welcome Bonus', code: 'WELCOME10' }] } as never)
    const res = await app.inject({ method: 'GET', url: '/admin/banners/campaign-options', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().campaigns).toEqual([{ id: CAMPAIGN_ID, name: 'Welcome Bonus', code: 'WELCOME10' }])
    expect(mockQuery.mock.calls[mockQuery.mock.calls.length - 1][0]).toMatch(/status = 'active'/)
  })
})

describe('POST /admin/banners', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('persists campaignId when provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: BANNER_ID }] } as never)
    const res = await app.inject({ method: 'POST', url: '/admin/banners', headers: { Authorization: 'Bearer t' },
      payload: { placement: 'landing', headline: 'Hi', campaignId: CAMPAIGN_ID } })
    expect(res.statusCode).toBe(201)
    const insertCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1]
    expect(insertCall[0]).toContain('campaign_id')
    const params = insertCall[1] as unknown[]
    expect(params[params.length - 1]).toBe(CAMPAIGN_ID)
  })

  it('stores null when campaignId is omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: BANNER_ID }] } as never)
    const res = await app.inject({ method: 'POST', url: '/admin/banners', headers: { Authorization: 'Bearer t' },
      payload: { placement: 'landing', headline: 'Hi' } })
    expect(res.statusCode).toBe(201)
    const insertCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1]
    const params = insertCall[1] as unknown[]
    expect(params[params.length - 1]).toBeNull()
  })
})

describe('PUT /admin/banners/:id', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('sets campaign_id when campaignId is provided', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never)
    const res = await app.inject({ method: 'PUT', url: `/admin/banners/${BANNER_ID}`, headers: { Authorization: 'Bearer t' },
      payload: { campaignId: CAMPAIGN_ID } })
    expect(res.statusCode).toBe(200)
    const updateCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1]
    expect(updateCall[0]).toMatch(/campaign_id = \$\d+/)
    const params = updateCall[1] as unknown[]
    const idx = Number((updateCall[0] as string).match(/campaign_id = \$(\d+)/)![1]) - 1
    expect(params[idx]).toBe(CAMPAIGN_ID)
    expect(params[params.length - 1]).toBe(BANNER_ID) // id remains the final param
  })

  it('clears campaign_id when campaignId is explicitly null', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never)
    const res = await app.inject({ method: 'PUT', url: `/admin/banners/${BANNER_ID}`, headers: { Authorization: 'Bearer t' },
      payload: { campaignId: null } })
    expect(res.statusCode).toBe(200)
    const updateCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1]
    expect(updateCall[0]).toMatch(/campaign_id = \$\d+/)
    const params = updateCall[1] as unknown[]
    const idx = Number((updateCall[0] as string).match(/campaign_id = \$(\d+)/)![1]) - 1
    expect(params[idx]).toBeNull()
    expect(params[params.length - 1]).toBe(BANNER_ID)
  })

  it('does not touch campaign_id when it is omitted from the payload', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never)
    const res = await app.inject({ method: 'PUT', url: `/admin/banners/${BANNER_ID}`, headers: { Authorization: 'Bearer t' },
      payload: { headline: 'New headline' } })
    expect(res.statusCode).toBe(200)
    const updateCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1]
    expect(updateCall[0]).not.toMatch(/campaign_id/)
    const params = updateCall[1] as unknown[]
    expect(params[params.length - 1]).toBe(BANNER_ID) // id remains the final param
  })
})
