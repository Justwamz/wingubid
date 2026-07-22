import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/crash.service.js', () => ({
  placeBet: vi.fn(),
  cashout: vi.fn(),
}))
vi.mock('./crash-loop.js', () => ({
  addBetToRound: vi.fn(),
  removeBetFromRound: vi.fn(),
  getCurrentRound: vi.fn(),
}))

import { placeBet, cashout } from '../services/crash.service.js'
import { addBetToRound, removeBetFromRound, getCurrentRound } from './crash-loop.js'
import { handleCrashSocket } from './crash-socket.js'

function makeSocket(playerId = 'player-1') {
  const handlers: Record<string, Function> = {}
  return {
    data: { playerId },
    on: vi.fn((event: string, fn: Function) => { handlers[event] = fn }),
    emit: vi.fn(),
    join: vi.fn(),
    _trigger: async (event: string, data?: any) => handlers[event]?.(data),
  }
}

function makeIo() {
  const roomEmit = vi.fn()
  return { to: vi.fn().mockReturnValue({ emit: roomEmit }), _roomEmit: roomEmit }
}

beforeEach(() => vi.clearAllMocks())

describe('bet:place', () => {
  it('places bet and emits bet:confirmed on success', async () => {
    vi.mocked(getCurrentRound).mockReturnValue({ status: 'waiting', roundId: 'r-1', bets: {} } as any)
    vi.mocked(placeBet).mockResolvedValueOnce({ betId: 'bet-1', effectiveStake: 10000 })

    const socket = makeSocket()
    const io = makeIo()
    handleCrashSocket(io as any, socket as any)

    await socket._trigger('bet:place', { grossStake: 10000 })

    expect(placeBet).toHaveBeenCalledWith('player-1', 'r-1', 10000, undefined, 'cash')
    expect(socket.emit).toHaveBeenCalledWith('bet:confirmed', expect.objectContaining({ betId: 'bet-1' }))
  })

  it('passes fundSource=bonus through to placeBet when specified', async () => {
    vi.mocked(getCurrentRound).mockReturnValue({ status: 'waiting', roundId: 'r-1', bets: {} } as any)
    vi.mocked(placeBet).mockResolvedValueOnce({ betId: 'bet-1', effectiveStake: 10000 })

    const socket = makeSocket()
    const io = makeIo()
    handleCrashSocket(io as any, socket as any)

    await socket._trigger('bet:place', { grossStake: 10000, fundSource: 'bonus' })

    expect(placeBet).toHaveBeenCalledWith('player-1', 'r-1', 10000, undefined, 'bonus')
  })

  it('rejects a negative grossStake without touching the wallet', async () => {
    vi.mocked(getCurrentRound).mockReturnValue({ status: 'waiting', roundId: 'r-1', bets: {} } as any)

    const socket = makeSocket()
    handleCrashSocket(makeIo() as any, socket as any)
    await socket._trigger('bet:place', { grossStake: -1000000 })

    expect(placeBet).not.toHaveBeenCalled()
    expect(socket.emit).toHaveBeenCalledWith('bet:error', expect.objectContaining({ code: 'VALIDATION_ERROR' }))
  })

  it('rejects a non-integer / fractional grossStake', async () => {
    vi.mocked(getCurrentRound).mockReturnValue({ status: 'waiting', roundId: 'r-1', bets: {} } as any)

    const socket = makeSocket()
    handleCrashSocket(makeIo() as any, socket as any)
    await socket._trigger('bet:place', { grossStake: 0.5 })

    expect(placeBet).not.toHaveBeenCalled()
    expect(socket.emit).toHaveBeenCalledWith('bet:error', expect.objectContaining({ code: 'VALIDATION_ERROR' }))
  })

  it('rejects an autoCashoutAt below 1.01', async () => {
    vi.mocked(getCurrentRound).mockReturnValue({ status: 'waiting', roundId: 'r-1', bets: {} } as any)

    const socket = makeSocket()
    handleCrashSocket(makeIo() as any, socket as any)
    await socket._trigger('bet:place', { grossStake: 10000, autoCashoutAt: 1.0 })

    expect(placeBet).not.toHaveBeenCalled()
    expect(socket.emit).toHaveBeenCalledWith('bet:error', expect.objectContaining({ code: 'VALIDATION_ERROR' }))
  })

  it('emits bet:error when round is not waiting', async () => {
    vi.mocked(getCurrentRound).mockReturnValue({ status: 'running', roundId: 'r-1', bets: {} } as any)

    const socket = makeSocket()
    handleCrashSocket(makeIo() as any, socket as any)
    await socket._trigger('bet:place', { grossStake: 10000 })

    expect(placeBet).not.toHaveBeenCalled()
    expect(socket.emit).toHaveBeenCalledWith('bet:error', expect.objectContaining({ code: 'ROUND_NOT_WAITING' }))
  })
})

describe('bet:cashout', () => {
  it('cashes out and emits cashout:confirmed + cashout:broadcast', async () => {
    vi.mocked(getCurrentRound).mockReturnValue({
      status: 'running', multiplier: 2.50, crashPoint: 5.00,
      bets: { 'player-1': { betId: 'bet-1', effectiveStake: 10000 } },
    } as any)
    vi.mocked(cashout).mockResolvedValueOnce({ winnings: 25000 })

    const socket = makeSocket()
    const io = makeIo()
    handleCrashSocket(io as any, socket as any)
    await socket._trigger('bet:cashout')

    expect(cashout).toHaveBeenCalledWith('player-1', 'bet-1', 2.50, 5.00)
    expect(socket.emit).toHaveBeenCalledWith('cashout:confirmed', { multiplier: 2.50, winnings: 25000 })
    expect(io._roomEmit).toHaveBeenCalledWith('cashout:broadcast', expect.objectContaining({ multiplier: 2.50 }))
  })

  it('rejects a manual cashout at/above the crash point without touching the wallet', async () => {
    // multiplier has reached the crash point in the race window before status flips
    vi.mocked(getCurrentRound).mockReturnValue({
      status: 'running', multiplier: 5.00, crashPoint: 5.00,
      bets: { 'player-1': { betId: 'bet-1', effectiveStake: 10000 } },
    } as any)

    const socket = makeSocket()
    handleCrashSocket(makeIo() as any, socket as any)
    await socket._trigger('bet:cashout')

    expect(cashout).not.toHaveBeenCalled()
    expect(socket.emit).toHaveBeenCalledWith('bet:error', expect.objectContaining({ code: 'ROUND_NOT_RUNNING' }))
  })

  it('emits bet:error when player has no active bet', async () => {
    vi.mocked(getCurrentRound).mockReturnValue({ status: 'running', multiplier: 1.5, crashPoint: 5.00, bets: {} } as any)

    const socket = makeSocket()
    handleCrashSocket(makeIo() as any, socket as any)
    await socket._trigger('bet:cashout')

    expect(socket.emit).toHaveBeenCalledWith('bet:error', expect.objectContaining({ code: 'NO_ACTIVE_BET' }))
  })
})
