'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { getToken } from '@/lib/auth'

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

  useEffect(() => {
    const socket = io(API_URL, {
      auth: { token: getToken() },
      transports: ['websocket'],
    })
    socketRef.current = socket

    socket.on('round:waiting', (data: { waitingEndsAt: number }) => {
      setStatus('waiting')
      setWaitingEndsAt(data.waitingEndsAt)
      setMultiplier(1.00)
      setCrashPoint(null)
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
      setRecentCrashes(prev => [data.crashPoint, ...prev].slice(0, 20))
    })
    socket.on('bet:confirmed', (data: MyBet) => setMyBet(data))
    socket.on('cashout:confirmed', () => setMyBet(null))
    socket.on('cashout:broadcast', (data: CashoutFeed) => {
      setFeed(data)
      setTimeout(() => setFeed(null), 3000)
    })
    socket.on('bet:error', (data: { message: string }) => setError(data.message))

    return () => { socket.disconnect() }
  }, [])

  const placeBet = useCallback((grossStake: number, autoCashoutAt?: number) => {
    setError(null)
    socketRef.current?.emit('bet:place', { grossStake, autoCashoutAt })
  }, [])

  const cashout = useCallback(() => {
    socketRef.current?.emit('bet:cashout')
  }, [])

  return { status, multiplier, myBet, crashPoint, waitingEndsAt, recentCrashes, feed, error, placeBet, cashout }
}
