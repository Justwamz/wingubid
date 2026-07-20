'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/apiFetch'
import type { BetHistoryEntry } from '@/components/game/BetHistory'

// Row shape returned by GET /games/history (the bets-backed endpoint).
interface CoreBetRow {
  betId: string
  game: string
  grossStake: number
  multiplier: number | null
  winnings: number | null
  status: string
  createdAt: string
}

function coreRowToEntry(r: CoreBetRow): BetHistoryEntry {
  return {
    id: r.betId,
    game: r.game,
    stake: r.grossStake,
    status: r.status,
    payout: r.winnings ?? 0,
    multiplier: r.multiplier,
    createdAt: r.createdAt,
  }
}

// Loads the logged-in player's bets for a single bets-backed game
// (crash / mines / dice) from /games/history. Pass a changing `refreshKey`
// (e.g. a per-bet counter) to reload after a new bet is placed.
export function useCoreBetHistory(game: string, limit = 10, refreshKey = 0) {
  const [entries, setEntries] = useState<BetHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch<CoreBetRow[]>('/games/history')
      .then(all => {
        if (cancelled) return
        setEntries(all.filter(b => b.game === game).slice(0, limit).map(coreRowToEntry))
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [game, limit, refreshKey])

  return { entries, loading, error }
}
