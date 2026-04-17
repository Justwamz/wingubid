import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('@/hooks/useCrashGame', () => ({
  useCrashGame: () => ({
    status: 'waiting',
    multiplier: 1,
    myBet: null,
    crashPoint: null,
    waitingEndsAt: null,
    recentCrashes: [],
    feed: null,
    error: null,
    placeBet: vi.fn(),
    cashout: vi.fn(),
  }),
}))

vi.mock('@/lib/apiFetch', () => ({ apiFetch: vi.fn() }))

import CrashPage from '../page'

describe('CrashPage', () => {
  it('renders without crashing', () => {
    const { container } = render(<CrashPage />)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders the chart container', () => {
    const { container } = render(<CrashPage />)
    expect(container.querySelector('[data-testid="crash-chart"]')).toBeTruthy()
  })
})
