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

  it('creates a deposit_match campaign and returns its id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CAMPAIGN_ID }] } as never) // insert
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // audit
    const res = await app.inject({ method: 'POST', url: '/admin/campaigns', headers: { Authorization: 'Bearer t' },
      payload: {
        key: 'deposit_match_2026', name: 'Deposit Match', type: 'deposit_match', rewardKind: 'deposit_match',
        matchPercent: 50, maxMatchCents: 100000, minDepositCents: 1000,
      } })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(CAMPAIGN_ID)
    const insertCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 2]
    expect(insertCall[0]).toContain('reward_kind')
    expect(insertCall[0]).toContain('match_percent')
    expect(insertCall[0]).toContain('max_match_cents')
    expect(insertCall[0]).toContain('min_deposit_cents')
    // Positional order in the INSERT (see campaigns.ts CREATE handler):
    // [key, name, description, type, amount_cents, expiry_days, starts_at, ends_at,
    //  created_by, code, criteria, reward_kind, match_percent, max_match_cents, min_deposit_cents]
    const params = insertCall[1] as unknown[]
    expect(params[4]).toBeNull() // amount_cents should be null for deposit_match
    expect(params[11]).toBe('deposit_match') // reward_kind
    expect(params[12]).toBe(50) // match_percent
    expect(params[13]).toBe(100000) // max_match_cents
    expect(params[14]).toBe(1000) // min_deposit_cents
  })

  it('rejects a deposit_match campaign missing matchPercent', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/campaigns', headers: { Authorization: 'Bearer t' },
      payload: { key: 'deposit_match_2026', name: 'Deposit Match', type: 'deposit_match', rewardKind: 'deposit_match', maxMatchCents: 100000 } })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a deposit_match campaign missing maxMatchCents', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/campaigns', headers: { Authorization: 'Bearer t' },
      payload: { key: 'deposit_match_2026', name: 'Deposit Match', type: 'deposit_match', rewardKind: 'deposit_match', matchPercent: 50 } })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a deposit_match campaign that also sets a promo code', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/campaigns', headers: { Authorization: 'Bearer t' },
      payload: {
        key: 'deposit_match_2026', name: 'Deposit Match', type: 'deposit_match', rewardKind: 'deposit_match',
        matchPercent: 50, maxMatchCents: 100000, code: 'MATCH50',
      } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
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

describe('PUT /admin/campaigns/:id', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('rejects setting a promo code on a deposit_match campaign', async () => {
    const res = await app.inject({ method: 'PUT', url: `/admin/campaigns/${CAMPAIGN_ID}`, headers: { Authorization: 'Bearer t' },
      payload: { rewardKind: 'deposit_match', code: 'MATCH50' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('allows updating a fixed campaign with a code', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never) // update
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // audit
    const res = await app.inject({ method: 'PUT', url: `/admin/campaigns/${CAMPAIGN_ID}`, headers: { Authorization: 'Bearer t' },
      payload: { rewardKind: 'fixed', code: 'WELCOME10' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('rejects setting a code-only edit on an existing deposit_match campaign (no rewardKind in payload)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ reward_kind: 'deposit_match' }] } as never) // lookup of persisted reward_kind
    const queryCallsBefore = mockQuery.mock.calls.length
    const res = await app.inject({ method: 'PUT', url: `/admin/campaigns/${CAMPAIGN_ID}`, headers: { Authorization: 'Bearer t' },
      payload: { code: 'FOO' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
    expect(res.json().error.message).toBe('Deposit-match bonuses cannot use a promo code.')
    // Only the SELECT lookup ran — the UPDATE (and audit) must never have been issued.
    expect(mockQuery.mock.calls.length).toBe(queryCallsBefore + 1)
    expect(mockQuery.mock.calls[queryCallsBefore][0]).toMatch(/SELECT reward_kind FROM bonus_campaigns/)
  })

  it('allows a code-only edit on an existing fixed campaign (no rewardKind in payload)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ reward_kind: 'fixed' }] } as never) // lookup of persisted reward_kind
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never) // update
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // audit
    const res = await app.inject({ method: 'PUT', url: `/admin/campaigns/${CAMPAIGN_ID}`, headers: { Authorization: 'Bearer t' },
      payload: { code: 'FOO' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('allows editing non-code fields on an existing deposit_match campaign without a lookup', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never) // update
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // audit
    const res = await app.inject({ method: 'PUT', url: `/admin/campaigns/${CAMPAIGN_ID}`, headers: { Authorization: 'Bearer t' },
      payload: { name: 'Renamed Deposit Match' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
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
