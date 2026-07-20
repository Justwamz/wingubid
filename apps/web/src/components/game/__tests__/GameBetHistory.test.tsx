import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { GameBetHistory } from '../GameBetHistory'

const mockFetch = vi.fn()
vi.mock('@/lib/apiFetch', () => ({ apiFetch: (...args: unknown[]) => mockFetch(...args) }))

describe('GameBetHistory', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('shows empty state when the player has no bets for this game', async () => {
    mockFetch.mockResolvedValue([])
    render(<GameBetHistory game="mines" />)
    await waitFor(() => {
      expect(screen.getByText(/no bets yet/i)).toBeTruthy()
    })
  })

  it('shows error state on fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))
    render(<GameBetHistory game="mines" />)
    await waitFor(() => {
      expect(screen.getByText(/could not load history/i)).toBeTruthy()
    })
  })

  it('renders only rows for the requested game, with stake/multiplier/payout', async () => {
    mockFetch.mockResolvedValue([
      { betId: '1', game: 'mines', status: 'won', grossStake: 10000, multiplier: 2.5, winnings: 25000, createdAt: '2026-07-20T10:00:00Z' },
      { betId: '2', game: 'dice', status: 'lost', grossStake: 5000, multiplier: null, winnings: null, createdAt: '2026-07-20T10:01:00Z' },
    ])
    render(<GameBetHistory game="mines" />)
    await waitFor(() => {
      expect(screen.getByText('WON')).toBeTruthy()
      expect(screen.getByText('100')).toBeTruthy()   // stake 10000c -> 100
      expect(screen.getByText('2.50×')).toBeTruthy()
      expect(screen.getByText('250')).toBeTruthy()    // payout 25000c -> 250
    })
    // The dice row must be filtered out.
    expect(screen.queryByText('LOST')).toBeNull()
  })
})
