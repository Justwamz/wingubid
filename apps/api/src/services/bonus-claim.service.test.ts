import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('./wallet.service.js', () => ({ grantBonus: vi.fn() }))
vi.mock('./bonus-eligibility.service.js', () => ({ evaluateBonusEligibility: vi.fn() }))

import { pool } from '@betting/db'
import { grantBonus } from './wallet.service.js'
import { evaluateBonusEligibility } from './bonus-eligibility.service.js'
import { claimCampaignBonus } from './bonus-claim.service.js'

const mockQuery = vi.mocked(pool.query)
const mockConnect = vi.mocked(pool.connect)
const mockGrant = vi.mocked(grantBonus)
const mockEligibility = vi.mocked(evaluateBonusEligibility)

const CAMPAIGN_ID = 'camp-1'
const PLAYER_ID = 'player-1'

const activeCampaign = {
  amount_cents: '5000',
  expiry_days: 30,
  status: 'active',
  starts_at: null,
  ends_at: null,
}

function makeMockClient(rows: any[][] = []) {
  let callIndex = 0
  return {
    query: vi.fn(async () => {
      const r = rows[callIndex] ?? []
      callIndex++
      return { rows: r, rowCount: r.length }
    }),
    release: vi.fn(),
  }
}

// Seeds the three pre-checks that always run before the eligibility check:
// campaign lookup, already-claimed check, active-bonus check.
function seedPreChecks(campaignRows: unknown[], claimedRows: unknown[] = [], activeRows: unknown[] = []) {
  mockQuery
    .mockResolvedValueOnce({ rows: campaignRows } as never) // campaign lookup
    .mockResolvedValueOnce({ rows: claimedRows } as never)  // already-claimed
    .mockResolvedValueOnce({ rows: activeRows } as never)   // active bonus
    .mockResolvedValueOnce({ rows: [] } as never)           // best-effort signal insert
}

beforeEach(() => {
  mockQuery.mockReset()
  mockConnect.mockReset()
  mockGrant.mockReset()
  mockEligibility.mockReset()
  mockEligibility.mockResolvedValue({ flags: [] })
})

describe('claimCampaignBonus', () => {
  it('grants the bonus and records the claim on the happy path', async () => {
    seedPreChecks([activeCampaign])
    mockGrant.mockResolvedValueOnce({ grantId: 'grant-1' })
    const client = makeMockClient()
    mockConnect.mockResolvedValueOnce(client as never)

    const result = await claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, '203.0.113.5', 'device-1')

    expect(result).toEqual({ amountCents: 5000 })
    expect(mockGrant).toHaveBeenCalledWith(
      client, PLAYER_ID, 5000, null, expect.any(Date), { source: 'campaign', campaignId: CAMPAIGN_ID },
    )
    expect(client.query.mock.calls[0][0]).toBe('BEGIN')
    const claimInsert = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('INSERT INTO bonus_claims'))
    expect(claimInsert![1]).toEqual([CAMPAIGN_ID, PLAYER_ID, 'grant-1'])
    expect(client.query.mock.calls.at(-1)![0]).toBe('COMMIT')
    expect(client.release).toHaveBeenCalled()

    // Best-effort claim signal was recorded with a validated IP.
    const signalInsert = mockQuery.mock.calls.find(c => (c[0] as string).includes('INSERT INTO player_signals'))
    expect(signalInsert![1]).toEqual([PLAYER_ID, '203.0.113.5', 'device-1'])
  })

  it('rejects an already-claimed campaign with 422', async () => {
    seedPreChecks([activeCampaign], [{ x: 1 }])

    await expect(claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined))
      .rejects.toMatchObject({ code: 'ALREADY_CLAIMED', statusCode: 422 })
    expect(mockGrant).not.toHaveBeenCalled()
  })

  it('rejects when the player already has an active bonus', async () => {
    seedPreChecks([activeCampaign], [], [{ x: 1 }])

    await expect(claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined))
      .rejects.toMatchObject({ code: 'ACTIVE_BONUS_EXISTS', statusCode: 422 })
    expect(mockGrant).not.toHaveBeenCalled()
  })

  it('rejects a paused campaign', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...activeCampaign, status: 'paused' }] } as never)

    await expect(claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined))
      .rejects.toMatchObject({ code: 'CAMPAIGN_UNAVAILABLE', statusCode: 422 })
    expect(mockGrant).not.toHaveBeenCalled()
  })

  it('rejects a campaign outside its start/end window', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    mockQuery.mockResolvedValueOnce({ rows: [{ ...activeCampaign, starts_at: future }] } as never)

    await expect(claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined))
      .rejects.toMatchObject({ code: 'CAMPAIGN_UNAVAILABLE', statusCode: 422 })
    expect(mockGrant).not.toHaveBeenCalled()
  })

  it('blocks on a hard abuse signal and does not grant', async () => {
    seedPreChecks([activeCampaign])
    mockEligibility.mockResolvedValueOnce({
      flags: [{ type: 'device_bonus', severity: 'warn', message: 'shared device' }],
    })

    await expect(claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined))
      .rejects.toMatchObject({ code: 'NOT_ELIGIBLE', statusCode: 422 })
    expect(mockGrant).not.toHaveBeenCalled()
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('maps a unique-violation on the transaction to ALREADY_CLAIMED', async () => {
    seedPreChecks([activeCampaign])
    mockGrant.mockResolvedValueOnce({ grantId: 'grant-1' })
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce({ code: '23505' }) // INSERT bonus_claims
        .mockResolvedValueOnce({ rows: [] }), // ROLLBACK
      release: vi.fn(),
    }
    mockConnect.mockResolvedValueOnce(client as never)

    await expect(claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined))
      .rejects.toMatchObject({ code: 'ALREADY_CLAIMED', statusCode: 422 })
    expect(client.release).toHaveBeenCalled()
  })
})
