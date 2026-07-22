import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Capture the socket event handlers the hook registers so the test can fire
// server events at it.
const handlers: Record<string, (data: unknown) => void> = {}
const fakeSocket = {
  on: (event: string, handler: (data: unknown) => void) => { handlers[event] = handler },
  emit: vi.fn(),
  disconnect: vi.fn(),
}

vi.mock('socket.io-client', () => ({ io: () => fakeSocket, Socket: class {} }))
vi.mock('@/lib/auth', () => ({ getToken: () => 'token', refreshBalance: () => {} }))

import { useCrashGame } from '../useCrashGame'

describe('useCrashGame settle counter (drives bet-history refresh)', () => {
  beforeEach(() => { for (const k of Object.keys(handlers)) delete handlers[k] })

  it('increments settledCount when the player cashes out (win)', () => {
    const { result } = renderHook(() => useCrashGame())
    expect(result.current.settledCount).toBe(0)
    act(() => { handlers['bet:confirmed']({ betId: 'b1', effectiveStake: 10000 }) })
    act(() => { handlers['cashout:confirmed']({ multiplier: 2, winnings: 20000 }) })
    expect(result.current.settledCount).toBe(1)
  })

  it('increments settledCount when the round crashes on an active bet (loss)', () => {
    const { result } = renderHook(() => useCrashGame())
    act(() => { handlers['bet:confirmed']({ betId: 'b2', effectiveStake: 10000 }) })
    act(() => { handlers['round:crashed']({ crashPoint: 1.5 }) })
    expect(result.current.settledCount).toBe(1)
  })

  it('does not increment when the round crashes with no active bet', () => {
    const { result } = renderHook(() => useCrashGame())
    act(() => { handlers['round:crashed']({ crashPoint: 2.0 }) })
    expect(result.current.settledCount).toBe(0)
  })
})
