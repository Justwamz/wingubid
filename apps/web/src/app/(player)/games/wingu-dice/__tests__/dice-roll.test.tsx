import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// One mocked apiFetch backs the page + its GameBetHistory child (both import
// from '@/lib/apiFetch'). It answers by URL.
const apiFetch = vi.fn()
vi.mock('@/lib/apiFetch', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }))
vi.mock('@/lib/auth', () => ({ refreshBalance: vi.fn() }))

import WinguDicePage from '../page'

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockImplementation((url: string) => {
    if (url === '/games/config') return Promise.resolve({ houseEdge: { dice: 5 } })
    if (url === '/wallet/balance') return Promise.resolve({ bonus_balance: 0 })
    if (url === '/games/history') return Promise.resolve([])
    if (url === '/games/dice/roll') return Promise.resolve({
      // The API returns the landed number in `result` (NOT `roll`). 73 is
      // distinctive so it can't collide with the target (50) or other numbers.
      result: 73, won: true, multiplier: 1.9, winnings: 19000,
      netCredited: 19000, fundSource: 'cash', capped: false,
      serverSeedHash: 'h', clientSeed: 'c', nonce: 1,
    })
    return Promise.resolve({})
  })
})

describe('Wingu Dice landed number', () => {
  it('renders the API result value as the landed roll after a roll', async () => {
    render(<WinguDicePage />)
    fireEvent.click(screen.getByRole('button', { name: /roll dice/i }))
    // ~1.4s suspense spin, then the landed number renders. Before the fix the
    // page read `data.roll` (undefined), so 73 never appeared. findAllByText
    // rejects when there are zero matches, so this fails on the buggy code.
    const matches = await screen.findAllByText('73', {}, { timeout: 3000 })
    expect(matches.length).toBeGreaterThan(0)
  })
})
