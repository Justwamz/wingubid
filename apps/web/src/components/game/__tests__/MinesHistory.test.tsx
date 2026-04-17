import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MinesHistory } from '../MinesHistory'

const mockFetch = vi.fn()
vi.mock('@/lib/apiFetch', () => ({ apiFetch: (...args: unknown[]) => mockFetch(...args) }))

describe('MinesHistory', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('shows empty state when no history', async () => {
    mockFetch.mockResolvedValue([])
    render(<MinesHistory />)
    await waitFor(() => {
      expect(screen.getByText(/no mines games yet/i)).toBeTruthy()
    })
  })

  it('renders rows for mines games', async () => {
    mockFetch.mockResolvedValue([
      {
        id: '1',
        gameType: 'mines',
        status: 'won',
        grossStake: 100,
        cashoutMultiplier: 2.5,
        winnings: 250,
        settledAt: '2026-04-16T10:00:00Z',
      },
    ])
    render(<MinesHistory />)
    await waitFor(() => {
      expect(screen.getByText('100')).toBeTruthy()
      expect(screen.getByText('2.50×')).toBeTruthy()
    })
  })
})
