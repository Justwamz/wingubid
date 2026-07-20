'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/apiFetch'
import { BetHistory, type BetHistoryEntry } from '@/components/game/BetHistory'

export default function MyBetsPage() {
  const [entries, setEntries] = useState<BetHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch<BetHistoryEntry[]>('/games/history/all')
      .then(rows => { if (!cancelled) setEntries(rows) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-2xl font-extrabold font-mono text-white">My Bets</h1>
      <BetHistory
        title="All Games"
        entries={entries}
        loading={loading}
        error={error}
        showGame
        emptyText="You haven't placed any bets yet."
      />
    </div>
  )
}
