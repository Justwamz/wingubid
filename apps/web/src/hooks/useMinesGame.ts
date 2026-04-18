'use client'
import { useState, useCallback } from 'react'
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

export function useMinesGame() {
  const [game, setGame] = useState<GameState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startGame = useCallback(async (grossStake: number, gridSize: number, mineCount: number) => {
    setLoading(true); setError(null)
    const { data, error: err } = await apiFetch<{
      gameId: string; serverSeedHash: string; clientSeed: string; gridSize: number; mineCount: number
    }>('/games/mines/start', { method: 'POST', body: JSON.stringify({ grossStake, gridSize, mineCount }) })
    setLoading(false)
    if (err) { setError(err.message); return }
    setGame({ gameId: data!.gameId, gridSize: data!.gridSize, mineCount: data!.mineCount,
      serverSeedHash: data!.serverSeedHash, revealedTiles: [], multiplier: 1 - 0.05,
      minePositions: null, status: 'active' })
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
      winnings: number; minePositions: number[]; serverSeed: string
    }>('/games/mines/cashout', { method: 'POST', body: JSON.stringify({ gameId: game.gameId }) })
    if (err) { setError(err.message); return }
    sounds.cashout(); haptics.win()
    setGame(g => g ? { ...g, minePositions: data!.minePositions, status: 'won' } : g)
    refreshBalance()
  }, [game])

  return { game, loading, error, startGame, revealTile, cashout }
}
