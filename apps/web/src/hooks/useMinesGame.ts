'use client'
import { useState, useCallback, useEffect } from 'react'
import { apiFetch } from '@/lib/api'
import { sounds } from '@/lib/sounds'
import { haptics } from '@/lib/haptics'
import { refreshBalance } from '@/lib/auth'

interface GameState {
  gameId: string
  gridSize: number
  mineCount: number
  serverSeedHash: string
  revealedTiles: number[]
  multiplier: number
  minePositions: number[] | null
  status: 'idle' | 'active' | 'won' | 'lost'
}

export interface MinesWin {
  winnings: number
  netCredited: number
  fundSource: 'cash' | 'bonus'
  capped: boolean
}

export function useMinesGame() {
  const [game, setGame] = useState<GameState | null>(null)
  const [loading, setLoading] = useState(false)
  const [hydrating, setHydrating] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastWin, setLastWin] = useState<MinesWin | null>(null)

  // Resume an in-progress game after a reload / navigation. Without this, the
  // active game left in Redis blocks every new start with GAME_ALREADY_ACTIVE
  // and the player is locked out of mines until the server-side TTL expires.
  useEffect(() => {
    let cancelled = false
    apiFetch<{ game: {
      gameId: string; gridSize: number; mineCount: number; serverSeedHash: string
      revealedTiles: number[]; multiplier: number; status: 'active'
    } | null }>('/games/mines/current', { cache: 'no-store' })
      .then(({ data }) => {
        if (cancelled || !data?.game) return
        const g = data.game
        setGame({
          gameId: g.gameId, gridSize: g.gridSize, mineCount: g.mineCount,
          serverSeedHash: g.serverSeedHash, revealedTiles: g.revealedTiles,
          multiplier: g.multiplier, minePositions: null, status: 'active',
        })
      })
      .finally(() => { if (!cancelled) setHydrating(false) })
    return () => { cancelled = true }
  }, [])

  const startGame = useCallback(async (grossStake: number, gridSize: number, mineCount: number, fundSource?: 'cash' | 'bonus') => {
    setLoading(true); setError(null)
    const { data, error: err } = await apiFetch<{
      gameId: string; serverSeedHash: string; clientSeed: string; gridSize: number; mineCount: number
    }>('/games/mines/start', { method: 'POST', body: JSON.stringify({ grossStake, gridSize, mineCount, fundSource }) })
    setLoading(false)
    if (err) { setError(err.message); return }
    setLastWin(null)
    setGame({ gameId: data!.gameId, gridSize: data!.gridSize, mineCount: data!.mineCount,
      serverSeedHash: data!.serverSeedHash, revealedTiles: [], multiplier: 1 - 0.05,
      minePositions: null, status: 'active' })
    refreshBalance()
  }, [])

  const revealTile = useCallback(async (tileIndex: number) => {
    if (!game || game.status !== 'active') return
    const { data, error: err } = await apiFetch<{
      safe: boolean; multiplier?: number; minePositions?: number[]
    }>('/games/mines/reveal', { method: 'POST', body: JSON.stringify({ gameId: game.gameId, tileIndex }) })
    if (err) { setError(err.message); return }
    if (data!.safe) {
      sounds.win(); haptics.win()
      setGame(g => g ? { ...g, revealedTiles: [...g.revealedTiles, tileIndex], multiplier: data!.multiplier! } : g)
    } else {
      sounds.mineHit(); haptics.lose()
      setGame(g => g ? { ...g, minePositions: data!.minePositions!, status: 'lost' } : g)
      refreshBalance()
    }
  }, [game])

  const cashout = useCallback(async () => {
    if (!game || game.status !== 'active') return
    const { data, error: err } = await apiFetch<{
      winnings: number; netCredited: number; fundSource: 'cash' | 'bonus'; capped: boolean
      minePositions: number[]; serverSeed: string
    }>('/games/mines/cashout', { method: 'POST', body: JSON.stringify({ gameId: game.gameId }) })
    if (err) { setError(err.message); return }
    sounds.cashout(); haptics.win()
    setLastWin({ winnings: data!.winnings, netCredited: data!.netCredited, fundSource: data!.fundSource, capped: data!.capped })
    setGame(g => g ? { ...g, minePositions: data!.minePositions, status: 'won' } : g)
    refreshBalance()
  }, [game])

  return { game, loading, hydrating, error, lastWin, startGame, revealTile, cashout }
}
