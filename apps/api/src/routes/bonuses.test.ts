import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: vi.fn(async (req: { playerId: string }) => { req.playerId = 'player-1' }),
}))
vi.mock('../services/bonus-claim.service.js', () => ({
  claimCampaignBonus: vi.fn(),
  resolveCampaignByCode: vi.fn(),
}))
vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { buildServer } from '../server.js'
import { pool } from '@betting/db'
import { claimCampaignBonus, resolveCampaignByCode } from '../services/bonus-claim.service.js'

const mockQuery = vi.mocked(pool.query)
const mockResolveCode = vi.mocked(resolveCampaignByCode)
const CAMP = '11111111-1111-1111-1111-111111111111'

describe('GET /bonuses/available', () => {
  const app = buildServer(); afterAll(() => app.close())
  it('lists claimable campaigns', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CAMP, key: 'welcome', name: 'Welcome', description: 'x', amount_cents: '5000', claimable: true }] } as never)
    const res = await app.inject({ method: 'GET', url: '/bonuses/available', headers: { Authorization: 'Bearer t' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().campaigns[0].key).toBe('welcome')
  })
})

describe('POST /bonuses/claim', () => {
  const app = buildServer(); afterAll(() => app.close())
  it('claims and returns the amount', async () => {
    vi.mocked(claimCampaignBonus).mockResolvedValueOnce({ amountCents: 5000 })
    const res = await app.inject({ method: 'POST', url: '/bonuses/claim', headers: { Authorization: 'Bearer t' }, payload: { campaignId: CAMP } })
    expect(res.statusCode).toBe(200)
    expect(res.json().amountCents).toBe(5000)
  })
  it('surfaces NOT_ELIGIBLE as 422', async () => {
    const { AppError } = await import('../lib/errors.js')
    vi.mocked(claimCampaignBonus).mockRejectedValueOnce(new AppError('NOT_ELIGIBLE', "You're not eligible for this bonus.", 422))
    const res = await app.inject({ method: 'POST', url: '/bonuses/claim', headers: { Authorization: 'Bearer t' }, payload: { campaignId: CAMP } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('NOT_ELIGIBLE')
  })
  it('rejects a non-uuid campaignId', async () => {
    const res = await app.inject({ method: 'POST', url: '/bonuses/claim', headers: { Authorization: 'Bearer t' }, payload: { campaignId: 'x' } })
    expect(res.statusCode).toBe(400)
  })
  it('resolves a code to a campaign and claims it', async () => {
    mockResolveCode.mockResolvedValueOnce(CAMP)
    vi.mocked(claimCampaignBonus).mockResolvedValueOnce({ amountCents: 2000 })
    const res = await app.inject({ method: 'POST', url: '/bonuses/claim', headers: { Authorization: 'Bearer t' }, payload: { code: 'summer25' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().amountCents).toBe(2000)
    expect(mockResolveCode).toHaveBeenCalledWith('summer25')
    expect(claimCampaignBonus).toHaveBeenCalledWith('player-1', CAMP, expect.anything(), undefined, 'summer25')
  })
  it('returns INVALID_CODE when the code does not resolve', async () => {
    mockResolveCode.mockResolvedValueOnce(null)
    vi.mocked(claimCampaignBonus).mockClear()
    const res = await app.inject({ method: 'POST', url: '/bonuses/claim', headers: { Authorization: 'Bearer t' }, payload: { code: 'nope' } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('INVALID_CODE')
    expect(claimCampaignBonus).not.toHaveBeenCalled()
  })
  it('rejects when neither campaignId nor code is provided', async () => {
    const res = await app.inject({ method: 'POST', url: '/bonuses/claim', headers: { Authorization: 'Bearer t' }, payload: {} })
    expect(res.statusCode).toBe(400)
  })
})
