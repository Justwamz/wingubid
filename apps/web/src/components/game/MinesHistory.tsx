'use client'

import React, { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/apiFetch'

interface BetRecord {
  id: string
  gameType: string
  status: 'won' | 'lost' | 'pending'
  grossStake: number
  cashoutMultiplier: number | null
  winnings: number | null
  settledAt: string | null
}

export function MinesHistory() {
  const [records, setRecords] = useState<BetRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    apiFetch<BetRecord[]>('/player/bets')
      .then(all => setRecords(all.filter(b => b.gameType === 'mines').slice(0, 5)))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="bg-game-card border border-game-border rounded-xl p-4">
        <p className="text-gray-500 text-sm text-center">Loading history...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-game-card border border-game-border rounded-xl p-4">
        <p className="text-warning-coral text-sm text-center">Could not load history.</p>
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="bg-game-card border border-game-border rounded-xl p-4">
        <p className="text-gray-500 text-sm text-center">No mines games yet.</p>
      </div>
    )
  }

  return (
    <div className="bg-game-card border border-game-border rounded-xl p-4 space-y-2">
      <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Recent Games</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 text-xs">
            <th scope="col" className="text-left py-1">Result</th>
            <th scope="col" className="text-right py-1">Stake</th>
            <th scope="col" className="text-right py-1">Multiplier</th>
            <th scope="col" className="text-right py-1">Winnings</th>
          </tr>
        </thead>
        <tbody>
          {records.map(r => (
            <tr key={r.id} className="border-t border-game-border">
              <td className="py-1.5">
                {r.status === 'won' ? (
                  <span className="text-accent-cyan font-bold">WIN</span>
                ) : r.status === 'pending' ? (
                  <span className="text-gray-400 font-bold">PENDING</span>
                ) : (
                  <span className="text-warning-coral font-bold">LOSS</span>
                )}
              </td>
              <td className="text-right text-white">{r.grossStake}</td>
              <td className="text-right text-gray-300">
                {r.cashoutMultiplier != null ? `${r.cashoutMultiplier.toFixed(2)}×` : '—'}
              </td>
              <td className={`text-right font-semibold ${r.status === 'won' ? 'text-accent-cyan' : r.status === 'pending' ? 'text-gray-400' : 'text-warning-coral'}`}>
                {r.winnings != null ? r.winnings : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
