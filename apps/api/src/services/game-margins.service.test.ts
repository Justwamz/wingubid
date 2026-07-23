import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('./wallet.service.js', () => ({
  debitForBet: vi.fn(async () => ({ transactionId: 'tx', walletId: 'w' })),
  creditWinnings: vi.fn(async () => ({ transactionId: 'tx', walletId: 'w' })),
  debitBonusForBet: vi.fn(async () => ({ walletId: 'w-1', grantId: 'g-1' })),
  settleBonusWin: vi.fn(async () => ({ net: 15000 })),
}))
vi.mock('./game-settings.service.js', () => ({
  assertGameEnabled: vi.fn(async () => {}),
  getBonusMaxWinCents: vi.fn(async () => 1_000_000),
}))
vi.mock('./scratch-seed.service.js', () => ({
  nextScratchRoll: vi.fn(async () => ({
    serverSeed: 'srv', serverSeedHash: 'hash', clientSeed: 'cli', nonce: 2,
  })),
}))

import { getLotteryMargins, getScratchMargin } from './game-margins.service.js'

beforeEach(() => vi.clearAllMocks())

describe('getLotteryMargins', () => {
  it('returns one entry per draw type with pick-6 prize tiers', () => {
    const margins = getLotteryMargins()
    expect(margins.length).toBeGreaterThan(0)

    for (const m of margins) {
      expect(m.prizes.match6).toBe(200000)
      expect(m.prizes.match5).toBe(800)
      expect(m.prizes.match4).toBe(40)
      expect(m.prizes.match3).toBe(3)
      expect(m.rtpPct).toBeCloseTo(43.57, 1)
      expect(m.edgePct).toBeCloseTo(56.43, 1)
    }
  })
})

describe('getScratchMargin', () => {
  it('produces a finite, positive RTP', () => {
    const margin = getScratchMargin()
    expect(Number.isFinite(margin.rtpPct)).toBe(true)
    expect(margin.rtpPct).toBeGreaterThan(0)
  })
})
