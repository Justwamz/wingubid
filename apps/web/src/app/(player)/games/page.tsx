'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface LeaderboardEntry {
  playerName: string; game: string; multiplier: number; winnings: number; currency: string
}

export default function GamesLobby() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])

  useEffect(() => {
    const load = () => apiFetch<LeaderboardEntry[]>('/games/leaderboard')
      .then(({ data }) => data && setLeaderboard(data))
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  const games = [
    {
      href: '/games/crash',
      name: 'CRASH',
      icon: '📈',
      description: 'Cash out before it crashes',
      color: '#00F2FE',
    },
    {
      href: '/games/mines',
      name: 'MINES',
      icon: '💎',
      description: 'Reveal gems, avoid mines',
      color: '#80508B',
    },
    {
      href: '/games/dice',
      name: 'DICE',
      icon: '🎲',
      description: 'Roll over or under your target',
      color: '#00F2FE',
    },
  ]

  return (
    <div className="min-h-screen bg-game-bg text-white p-4 max-w-md mx-auto">
      <h1 className="text-3xl font-bold font-mono mb-6" style={{ color: '#00F2FE' }}>GAMES</h1>

      <div className="flex flex-col gap-3 mb-8">
        {games.map(g => (
          <Link key={g.href} href={g.href}>
            <div className="bg-game-card border border-game-border rounded-xl p-4 flex items-center gap-4 active:scale-98 transition-transform">
              <span className="text-4xl">{g.icon}</span>
              <div className="flex-1">
                <p className="font-mono font-bold text-lg" style={{ color: g.color }}>{g.name}</p>
                <p className="text-sm text-gray-400">{g.description}</p>
              </div>
              <span className="text-accent-violet">›</span>
            </div>
          </Link>
        ))}
      </div>

      {leaderboard.length > 0 && (
        <div>
          <h2 className="text-sm font-mono text-gray-400 mb-2 uppercase tracking-wider">Recent Wins</h2>
          <div className="space-y-2">
            {leaderboard.map((e, i) => (
              <div key={i} className="flex items-center justify-between bg-game-card rounded-lg px-3 py-2 text-sm">
                <span className="text-gray-300">{e.playerName}</span>
                <span className="text-accent-violet font-mono">{e.game.toUpperCase()}</span>
                <span className="text-accent-cyan font-mono font-bold">{e.multiplier.toFixed(2)}×</span>
                <span className="text-white font-mono">{e.currency} {e.winnings}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
