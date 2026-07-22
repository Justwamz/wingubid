'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { getToken, refreshBalance } from '@/lib/auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export type RoundStatus = 'idle' | 'waiting' | 'running' | 'crashed'

export interface MyBet {
  betId: string
  effectiveStake: number
  autoCashoutAt?: number
}

export interface CashoutFeed {
  playerId: string
  multiplier: number
  winnings: number
}

export function useCrashGame() {
  const socketRef = useRef<Socket | null>(null)
  const [status, setStatus] = useState<RoundStatus>('idle')
  const [multiplier, setMultiplier] = useState(1.00)
  const [myBet, setMyBet] = useState<MyBet | null>(null)
  const [crashPoint, setCrashPoint] = useState<number | null>(null)
  const [waitingEndsAt, setWaitingEndsAt] = useState<number | null>(null)
  const [recentCrashes, setRecentCrashes] = useState<number[]>([])
  const [feed, setFeed] = useState<CashoutFeed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [cashoutResult, setCashoutResult] = useState<{ multiplier: number; winnings: number; netCredited: number; fundSource: 'cash' | 'bonus'; capped: boolean } | null>(null)
  // Bumped whenever the player's bet settles (cashout win, or a loss when the
  // round crashes on an active bet). The page passes it to GameBetHistory as a
  // refreshKey so the bet-history panel reloads after each settlement - crash is
  // socket-driven, so without this the panel only ever showed the state at load.
  const [settledCount, setSettledCount] = useState(0)
  const hadBetRef = useRef(false)

  useEffect(() => {
    const socket = io(API_URL, {
      auth: (cb: (o: { token: string | null }) => void) => cb({ token: getToken() }),
    })
    socketRef.current = socket

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    socket.on('round:waiting', (data: { waitingEndsAt: number }) => {
      setStatus('waiting')
      setWaitingEndsAt(data.waitingEndsAt)
      setMultiplier(1.00)
      setCrashPoint(null)
      setError(null)
      setCashoutResult(null)
    })
    socket.on('round:started', () => {
      setStatus('running')
      setMultiplier(1.00)
    })
    socket.on('round:tick', (data: { multiplier: number }) => {
      setMultiplier(data.multiplier)
    })
    socket.on('round:crashed', (data: { crashPoint: number }) => {
      setStatus('crashed')
      setCrashPoint(data.crashPoint)
      setMyBet(null)
      // A loss: the player's active bet was just settled to 'lost' server-side
      // (settleLostBets commits before this event is emitted), so refresh history.
      if (hadBetRef.current) {
        hadBetRef.current = false
        setSettledCount(c => c + 1)
      }
      setRecentCrashes(prev => [data.crashPoint, ...prev].slice(0, 20))
      refreshBalance()
    })
    socket.on('bet:confirmed', (data: MyBet) => { setMyBet(data); hadBetRef.current = true; refreshBalance() })
    socket.on('cashout:confirmed', (data: { multiplier: number; winnings: number; netCredited: number; fundSource: 'cash' | 'bonus'; capped: boolean }) => {
      setMyBet(null)
      hadBetRef.current = false
      setCashoutResult(data)
      // A win: cashout() has committed status='won' before this event, so refresh.
      setSettledCount(c => c + 1)
      refreshBalance()
    })
    socket.on('cashout:broadcast', (data: CashoutFeed) => {
      setFeed(data)
      setTimeout(() => setFeed(null), 3000)
    })
    socket.on('bet:error', (data: { message: string }) => setError(data.message))

    return () => { socket.disconnect() }
  }, [])

  const placeBet = useCallback((grossStake: number, autoCashoutAt?: number, fundSource?: 'cash' | 'bonus') => {
    setError(null)
    socketRef.current?.emit('bet:place', { grossStake, autoCashoutAt, fundSource })
  }, [])

  const cashout = useCallback(() => {
    socketRef.current?.emit('bet:cashout')
  }, [])

  return { status, multiplier, myBet, crashPoint, waitingEndsAt, recentCrashes, feed, error, connected, cashoutResult, settledCount, placeBet, cashout }
}
