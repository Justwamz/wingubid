import { describe, it, expect, vi } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { rankGames, type OrderGame, type GameStat } from './game-order.service.js'

const base = (): Record<OrderGame, GameStat> => ({
  crash: { staked: 0, paid: 0 }, mines: { staked: 0, paid: 0 }, dice: { staked: 0, paid: 0 },
  scratch: { staked: 0, paid: 0 }, lottery: { staked: 0, paid: 0 },
})

describe('rankGames', () => {
  it('ranks the highest revenue+activity game first', () => {
    const s = base()
    s.dice = { staked: 1_000_000, paid: 900_000 }   // rev 100k, high activity
    s.mines = { staked: 500_000, paid: 490_000 }    // rev 10k
    s.crash = { staked: 300_000, paid: 250_000 }    // rev 50k, lower activity
    const order = rankGames(s)
    expect(order[0]).toBe('dice')
    expect(order).toContain('mines')
    expect(order).toContain('crash')
  })

  it('excludes games below the minimum stake volume', () => {
    const s = base()
    s.dice = { staked: 1_000_000, paid: 800_000 }
    s.scratch = { staked: 5_000, paid: 0 } // below MIN_STAKE (100000)
    const order = rankGames(s)
    expect(order).toContain('dice')
    expect(order).not.toContain('scratch')
  })

  it('handles a game running at a loss (negative revenue) without breaking order', () => {
    const s = base()
    s.crash = { staked: 1_000_000, paid: 1_200_000 } // house down 200k
    s.dice = { staked: 1_000_000, paid: 800_000 }    // house up 200k
    const order = rankGames(s)
    expect(order[0]).toBe('dice')      // profitable game ranks above the loss-making one
    expect(order[1]).toBe('crash')
  })

  it('returns [] when nothing meets the threshold', () => {
    expect(rankGames(base())).toEqual([])
  })
})
