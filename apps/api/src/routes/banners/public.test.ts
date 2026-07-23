import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))

import { buildServer } from '../../server.js'
import { pool } from '@betting/db'

const mockQuery = vi.mocked(pool.query)

const BANNER_ID = '11111111-1111-1111-1111-111111111111'
const CAMPAIGN_ID = '22222222-2222-2222-2222-222222222222'

describe('GET /banners/landing', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('resolves ctaUrl to /rewards?code=<CODE> for a linked banner with a coded campaign', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: BANNER_ID, headline: 'Hi', subtext: 'Sub', cta_text: 'Claim',
      cta_url: '/ignored', image_url: '/img.png', gradient: 'blue',
      campaign_id: CAMPAIGN_ID, campaign_code: 'WELCOME10',
    }] } as never)

    const res = await app.inject({ method: 'GET', url: '/banners/landing' })
    expect(res.statusCode).toBe(200)
    expect(res.json().banner.ctaUrl).toBe('/rewards?code=WELCOME10')
  })

  it('resolves ctaUrl to /rewards for a linked banner whose campaign has no code', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: BANNER_ID, headline: 'Hi', subtext: 'Sub', cta_text: 'Claim',
      cta_url: '/ignored', image_url: '/img.png', gradient: 'blue',
      campaign_id: CAMPAIGN_ID, campaign_code: null,
    }] } as never)

    const res = await app.inject({ method: 'GET', url: '/banners/landing' })
    expect(res.statusCode).toBe(200)
    expect(res.json().banner.ctaUrl).toBe('/rewards')
  })

  it('keeps the banner own cta_url when the banner is unlinked', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: BANNER_ID, headline: 'Hi', subtext: 'Sub', cta_text: 'Claim',
      cta_url: '/play-now', image_url: '/img.png', gradient: 'blue',
      campaign_id: null, campaign_code: null,
    }] } as never)

    const res = await app.inject({ method: 'GET', url: '/banners/landing' })
    expect(res.statusCode).toBe(200)
    expect(res.json().banner.ctaUrl).toBe('/play-now')
  })
})
