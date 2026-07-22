import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))
vi.mock('./game-settings.service.js', () => ({ getBonusAbuseConfig: vi.fn() }))

import { pool } from '@betting/db'
import { getBonusAbuseConfig } from './game-settings.service.js'
import { evaluateBonusEligibility } from './bonus-eligibility.service.js'

const mockQuery = vi.mocked(pool.query)
const mockCfg = vi.mocked(getBonusAbuseConfig)

// The engine runs 4 queries in order: prior_bonus, device_bonus, ip_bonus, velocity.
function seed(prior: unknown[], device: unknown[], ip: unknown[], velocity: number) {
  mockQuery.mockReset()
  mockQuery
    .mockResolvedValueOnce({ rows: prior } as never)
    .mockResolvedValueOnce({ rows: device } as never)
    .mockResolvedValueOnce({ rows: ip } as never)
    .mockResolvedValueOnce({ rows: [{ n: String(velocity) }] } as never)
}

beforeEach(() => { mockCfg.mockResolvedValue({ ipVelocityFlag: 3, ipVelocityBlock: 0 }) })

describe('evaluateBonusEligibility', () => {
  it('returns no flags for a clean player', async () => {
    seed([], [], [], 1)
    const { flags } = await evaluateBonusEligibility('p1')
    expect(flags).toHaveLength(0)
  })

  it('flags prior_bonus when the player already has a grant', async () => {
    seed([{ x: 1 }], [], [], 1)
    const { flags } = await evaluateBonusEligibility('p1')
    expect(flags.find(f => f.type === 'prior_bonus')?.severity).toBe('warn')
  })

  it('flags device_bonus and ip_bonus with matched ids', async () => {
    seed([], [{ player_id: 'p2' }], [{ player_id: 'p3' }], 1)
    const { flags } = await evaluateBonusEligibility('p1')
    const dev = flags.find(f => f.type === 'device_bonus')
    expect(dev?.matchedPlayerIds).toEqual(['p2'])
    expect(flags.find(f => f.type === 'ip_bonus')?.count).toBe(1)
  })

  it('warns on ip_velocity at the flag threshold', async () => {
    seed([], [], [], 3)
    const { flags } = await evaluateBonusEligibility('p1')
    expect(flags.find(f => f.type === 'ip_velocity')?.severity).toBe('warn')
  })

  it('blocks on ip_velocity when block threshold is set and met', async () => {
    mockCfg.mockResolvedValue({ ipVelocityFlag: 3, ipVelocityBlock: 5 })
    seed([], [], [], 5)
    const { flags } = await evaluateBonusEligibility('p1')
    expect(flags.find(f => f.type === 'ip_velocity')?.severity).toBe('block')
  })
})
