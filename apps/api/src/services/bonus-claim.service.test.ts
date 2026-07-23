import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('./wallet.service.js', () => ({ grantBonus: vi.fn() }))
vi.mock('./bonus-eligibility.service.js', () => ({ evaluateBonusEligibility: vi.fn() }))
vi.mock('./bonus-criteria.service.js', () => ({ playerMatchesCriteria: vi.fn() }))

import { pool } from '@betting/db'
import { grantBonus } from './wallet.service.js'
import { evaluateBonusEligibility } from './bonus-eligibility.service.js'
import { playerMatchesCriteria } from './bonus-criteria.service.js'
import { claimCampaignBonus, resolveCampaignByCode } from './bonus-claim.service.js'

const mockQuery = vi.mocked(pool.query)
const mockConnect = vi.mocked(pool.connect)
const mockGrant = vi.mocked(grantBonus)
const mockEligibility = vi.mocked(evaluateBonusEligibility)
const mockCriteria = vi.mocked(playerMatchesCriteria)

const CAMPAIGN_ID = 'camp-1'
const PLAYER_ID = 'player-1'

const activeCampaign = {
  amount_cents: '5000',
  expiry_days: 30,
  status: 'active',
  starts_at: null,
  ends_at: null,
  code: null,
  criteria: null,
  reward_kind: 'fixed',
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

// Seeds the player-status gate plus the three pre-checks that always run
// before the eligibility check: campaign lookup, already-claimed check,
// active-bonus check.
function seedPreChecks(campaignRows: unknown[], claimedRows: unknown[] = [], activeRows: unknown[] = []) {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ status: 'active' }] } as never) // player status
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
  mockCriteria.mockReset()
  mockCriteria.mockResolvedValue(true)
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
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'active' }] } as never) // player status
      .mockResolvedValueOnce({ rows: [{ ...activeCampaign, status: 'paused' }] } as never)

    await expect(claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined))
      .rejects.toMatchObject({ code: 'CAMPAIGN_UNAVAILABLE', statusCode: 422 })
    expect(mockGrant).not.toHaveBeenCalled()
  })

  it('rejects a deposit-match campaign with 422 CAMPAIGN_UNAVAILABLE, without granting', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'active' }] } as never) // player status
      .mockResolvedValueOnce({ rows: [{ ...activeCampaign, reward_kind: 'deposit_match' }] } as never)

    await expect(claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined))
      .rejects.toMatchObject({ code: 'CAMPAIGN_UNAVAILABLE', statusCode: 422 })
    expect(mockGrant).not.toHaveBeenCalled()
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('rejects a campaign outside its start/end window', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'active' }] } as never) // player status
      .mockResolvedValueOnce({ rows: [{ ...activeCampaign, starts_at: future }] } as never)

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

  it('rejects a code campaign when no code is provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'active' }] } as never) // player status
      .mockResolvedValueOnce({ rows: [{ ...activeCampaign, code: 'SUMMER25' }] } as never)

    await expect(claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined))
      .rejects.toMatchObject({ code: 'INVALID_CODE', statusCode: 422 })
    expect(mockGrant).not.toHaveBeenCalled()
  })

  it('rejects a code campaign when the wrong code is provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'active' }] } as never) // player status
      .mockResolvedValueOnce({ rows: [{ ...activeCampaign, code: 'SUMMER25' }] } as never)

    await expect(claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined, 'WINTER10'))
      .rejects.toMatchObject({ code: 'INVALID_CODE', statusCode: 422 })
    expect(mockGrant).not.toHaveBeenCalled()
  })

  it('proceeds past the code gate with a correct, case-insensitive, untrimmed code', async () => {
    seedPreChecks([{ ...activeCampaign, code: 'SUMMER25' }])
    mockGrant.mockResolvedValueOnce({ grantId: 'grant-1' })
    const client = makeMockClient()
    mockConnect.mockResolvedValueOnce(client as never)

    const result = await claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined, '  summer25  ')

    expect(result).toEqual({ amountCents: 5000 })
    expect(mockGrant).toHaveBeenCalled()
  })

  it('rejects a targeted campaign the player does not match, without granting', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'active' }] } as never) // player status
      .mockResolvedValueOnce({ rows: [{ ...activeCampaign, criteria: { depositStatus: 'has' } }] } as never)
    mockCriteria.mockResolvedValueOnce(false)

    await expect(claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined))
      .rejects.toMatchObject({ code: 'NOT_ELIGIBLE', statusCode: 422 })
    expect(mockCriteria).toHaveBeenCalledWith(PLAYER_ID, { depositStatus: 'has' })
    expect(mockGrant).not.toHaveBeenCalled()
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('proceeds past the criteria gate when the player matches', async () => {
    seedPreChecks([{ ...activeCampaign, criteria: { depositStatus: 'has' } }])
    mockCriteria.mockResolvedValueOnce(true)
    mockGrant.mockResolvedValueOnce({ grantId: 'grant-1' })
    const client = makeMockClient()
    mockConnect.mockResolvedValueOnce(client as never)

    const result = await claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined)

    expect(result).toEqual({ amountCents: 5000 })
    expect(mockGrant).toHaveBeenCalled()
  })

  it.each(['suspended', 'self_excluded'])(
    'rejects a claim from a %s player with 422 NOT_ELIGIBLE, without granting',
    async (status) => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status }] } as never) // player status

      await expect(claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined))
        .rejects.toMatchObject({ code: 'NOT_ELIGIBLE', statusCode: 422 })
      expect(mockGrant).not.toHaveBeenCalled()
      expect(mockConnect).not.toHaveBeenCalled()
      // Only the player-status lookup ran; the claim never touched the campaign.
      expect(mockQuery).toHaveBeenCalledTimes(1)
    },
  )

  it('rejects a claim when the player id does not exist, without granting', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // player status: no such player

    await expect(claimCampaignBonus(PLAYER_ID, CAMPAIGN_ID, undefined, undefined))
      .rejects.toMatchObject({ code: 'NOT_ELIGIBLE', statusCode: 422 })
    expect(mockGrant).not.toHaveBeenCalled()
    expect(mockConnect).not.toHaveBeenCalled()
  })
})

describe('resolveCampaignByCode', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('resolves a campaign id for a matching, case/space-insensitive code', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CAMPAIGN_ID }] } as never)

    const result = await resolveCampaignByCode('  summer25  ')

    expect(result).toBe(CAMPAIGN_ID)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE code = $1'), ['SUMMER25'])
  })

  it('returns null when no campaign matches the code', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    const result = await resolveCampaignByCode('NOPE')

    expect(result).toBeNull()
  })
})
