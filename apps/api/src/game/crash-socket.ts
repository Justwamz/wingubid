import { z } from 'zod'
import type { Server, Socket } from 'socket.io'
import { verifyPlayerAccessToken } from '../lib/jwt.js'
import { placeBet, cashout } from '../services/crash.service.js'
import { addBetToRound, removeBetFromRound, getCurrentRound, sendCurrentStateTo } from './crash-loop.js'

// Socket payloads are untrusted input just like HTTP bodies — validate with the
// same rules the HTTP game routes use. Without this, a negative grossStake would
// credit the wallet (balance - (-x) = balance + x) instead of debiting it.
const betPlaceSchema = z.object({
  grossStake: z.number().int().positive(),
  autoCashoutAt: z.number().min(1.01).optional(),
})

export function registerCrashSocket(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) { socket.disconnect(); return }

    try {
      const payload = verifyPlayerAccessToken(token)
      socket.data.playerId = payload.sub
    } catch {
      socket.disconnect()
      return
    }

    socket.join('crash')
    sendCurrentStateTo(socket)
    handleCrashSocket(io, socket)
  })
}

export function handleCrashSocket(io: Server, socket: Socket): void {
  socket.on('bet:place', async (data: unknown) => {
    const playerId: string = socket.data.playerId

    const parsed = betPlaceSchema.safeParse(data)
    if (!parsed.success) {
      socket.emit('bet:error', { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message })
      return
    }
    const { grossStake, autoCashoutAt } = parsed.data

    const round = getCurrentRound()

    if (!round || round.status !== 'waiting') {
      socket.emit('bet:error', { code: 'ROUND_NOT_WAITING', message: 'No waiting round' })
      return
    }
    if (round.bets[playerId]) {
      socket.emit('bet:error', { code: 'BET_ALREADY_PLACED', message: 'Already bet this round' })
      return
    }

    try {
      const bet = await placeBet(playerId, round.roundId, grossStake, autoCashoutAt)
      addBetToRound(playerId, bet.betId, bet.effectiveStake, autoCashoutAt)
      socket.emit('bet:confirmed', { betId: bet.betId, effectiveStake: bet.effectiveStake })
    } catch (err: any) {
      socket.emit('bet:error', { code: err.code ?? 'BET_FAILED', message: err.message })
    }
  })

  socket.on('bet:cashout', async () => {
    const playerId: string = socket.data.playerId
    const round = getCurrentRound()

    if (!round || round.status !== 'running') {
      socket.emit('bet:error', { code: 'ROUND_NOT_RUNNING', message: 'Round not running' })
      return
    }
    const bet = round.bets[playerId]
    if (!bet) {
      socket.emit('bet:error', { code: 'NO_ACTIVE_BET', message: 'No active bet' })
      return
    }

    try {
      const { winnings } = await cashout(playerId, bet.betId, round.multiplier)
      removeBetFromRound(playerId)
      socket.emit('cashout:confirmed', { multiplier: round.multiplier, winnings })
      io.to('crash').emit('cashout:broadcast', { playerId, multiplier: round.multiplier, winnings })
    } catch (err: any) {
      socket.emit('bet:error', { code: err.code ?? 'CASHOUT_FAILED', message: err.message })
    }
  })
}
