import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('./wallet.service.js', () => ({ grantBonus: vi.fn() }))
vi.mock('./bonus-criteria.service.js', () => ({ playerMatchesCriteria: vi.fn() }))

import { pool } from '@betting/db'
import { grantBonus } from './wallet.service.js'
import { playerMatchesCriteria } from './bonus-criteria.service.js'
import { maybeGrantDepositMatch } from './deposit-match.service.js'

const mockQuery = vi.mocked(pool.query)
const mockConnect = vi.mocked(pool.connect)
const mockGrant = vi.mocked(grantBonus)
const mockCriteria = vi.mocked(playerMatchesCriteria)

const PLAYER_ID = 'player-1'

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

// Seeds the fixed-order pool.query calls that always run before the grant
// transaction: player-status SELECT, active-bonus SELECT, candidates SELECT.
function seedPreChecks(campaignRows: unknown[], activeBonusRows: unknown[] = []) {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ status: 'active' }] } as never) // player status
    .mockResolvedValueOnce({ rows: activeBonusRows } as never)        // active bonus
    .mockResolvedValueOnce({ rows: campaignRows } as never)           // candidates
}

const campaign = {
  id: 'camp-1',
  match_percent: 50,
  max_match_cents: '2000',
  expiry_days: 30,
  criteria: null,
}

beforeEach(() => {
  mockQuery.mockReset()
  mockConnect.mockReset()
  mockGrant.mockReset()
  mockCriteria.mockReset()
  mockCriteria.mockResolvedValue(true)
})

describe('maybeGrantDepositMatch', () => {
  it('grants min(floor(dep*pct/100), cap) and records the claim on the happy path', async () => {
    // deposit=10001, pct=50 -> raw floor(5000.5)=5000, capped at 2000 by max_match_cents.
    seedPreChecks([campaign])
    mockGrant.mockResolvedValueOnce({ grantId: 'grant-1' })
    const client = makeMockClient()
    mockConnect.mockResolvedValueOnce(client as never)

    await maybeGrantDepositMatch(PLAYER_ID, 10001)

    expect(mockGrant).toHaveBeenCalledWith(
      client, PLAYER_ID, 2000, null, expect.any(Date), { source: 'campaign', campaignId: 'camp-1' },
    )
    expect(client.query.mock.calls[0][0]).toBe('BEGIN')
    const claimInsert = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('INSERT INTO bonus_claims'))
    expect(claimInsert![1]).toEqual(['camp-1', PLAYER_ID, 'grant-1'])
    expect(client.query.mock.calls.at(-1)![0]).toBe('COMMIT')
    expect(client.release).toHaveBeenCalled()
  })

  it.each(['suspended', 'self_excluded'])(
    'does not grant when the player status is %s',
    async (status) => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status }] } as never)

      await maybeGrantDepositMatch(PLAYER_ID, 10000)

      expect(mockGrant).not.toHaveBeenCalled()
      expect(mockConnect).not.toHaveBeenCalled()
      expect(mockQuery).toHaveBeenCalledTimes(1)
    },
  )

  it('does not grant when the player does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    await maybeGrantDepositMatch(PLAYER_ID, 10000)

    expect(mockGrant).not.toHaveBeenCalled()
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('does not grant when the player already has an active bonus', async () => {
    seedPreChecks([campaign], [{ x: 1 }])

    await maybeGrantDepositMatch(PLAYER_ID, 10000)

    expect(mockGrant).not.toHaveBeenCalled()
    expect(mockConnect).not.toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('does not grant when there is no candidate campaign', async () => {
    seedPreChecks([])

    await maybeGrantDepositMatch(PLAYER_ID, 10000)

    expect(mockGrant).not.toHaveBeenCalled()
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('skips a campaign whose criteria the player does not match, without granting', async () => {
    seedPreChecks([{ ...campaign, criteria: { depositStatus: 'has' } }])
    mockCriteria.mockResolvedValueOnce(false)

    await maybeGrantDepositMatch(PLAYER_ID, 10000)

    expect(mockCriteria).toHaveBeenCalledWith(PLAYER_ID, { depositStatus: 'has' })
    expect(mockGrant).not.toHaveBeenCalled()
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('picks the newest qualifying campaign when several are returned', async () => {
    const newer = { id: 'camp-new', match_percent: 10, max_match_cents: '100000', expiry_days: 7, criteria: null }
    const older = { id: 'camp-old', match_percent: 90, max_match_cents: '100000', expiry_days: 30, criteria: null }
    // pool orders candidates by created_at DESC, so newer comes first.
    seedPreChecks([newer, older])
    mockGrant.mockResolvedValueOnce({ grantId: 'grant-2' })
    const client = makeMockClient()
    mockConnect.mockResolvedValueOnce(client as never)

    await maybeGrantDepositMatch(PLAYER_ID, 10000)

    expect(mockGrant).toHaveBeenCalledWith(
      client, PLAYER_ID, 1000, null, expect.any(Date), { source: 'campaign', campaignId: 'camp-new' },
    )
  })

  it('rolls back and swallows quietly on a unique-violation race (already matched)', async () => {
    seedPreChecks([campaign])
    mockGrant.mockResolvedValueOnce({ grantId: 'grant-1' })
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce({ code: '23505' }) // INSERT bonus_claims
        .mockResolvedValueOnce({ rows: [] }), // ROLLBACK
      release: vi.fn(),
    }
    mockConnect.mockResolvedValueOnce(client as never)

    await expect(maybeGrantDepositMatch(PLAYER_ID, 10001)).resolves.toBeUndefined()

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalled()
  })

  it('resolves (never rejects) when the pool throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))

    await expect(maybeGrantDepositMatch(PLAYER_ID, 10000)).resolves.toBeUndefined()

    expect(mockGrant).not.toHaveBeenCalled()
  })
})
