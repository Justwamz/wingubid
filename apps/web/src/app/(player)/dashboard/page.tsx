'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { TrendingUp, Gem, Dice6 } from 'lucide-react'

interface PlayerProfile {
  name: string
  phone: string
  country: string
  currency: string
  wallet: { balance: number; bonus_balance: number }
}

export default function DashboardPage() {
  const router = useRouter()
  const [player, setPlayer] = useState<PlayerProfile | null>(null)

  useEffect(() => {
    apiFetch<PlayerProfile>('/player/me').then(({ data }) => {
      if (data) setPlayer(data)
    })
  }, [])

  if (!player) return <div className="p-8 text-gray-500 text-sm">Loading…</div>

  const balance = (player.wallet.balance / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })
  const bonus = (player.wallet.bonus_balance / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-2xl font-extrabold font-mono text-white">
        Welcome back, <span className="text-accent-cyan">{player.name}</span>
      </h1>

      {/* Balance cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-cyan-500/10 to-blue-600/5 border border-cyan-500/20 rounded-2xl p-5">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Balance</p>
          <p className="text-3xl font-extrabold font-mono text-white">{player.currency} {balance}</p>
        </div>
        <div className="bg-gradient-to-br from-violet-500/10 to-purple-700/5 border border-violet-500/20 rounded-2xl p-5">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Bonus</p>
          <p className="text-3xl font-extrabold font-mono text-white">{player.currency} {bonus}</p>
        </div>
        <div className="bg-game-card border border-game-border rounded-2xl p-5 sm:col-span-2 lg:col-span-1">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Account</p>
          <p className="text-sm text-gray-300 mt-1">{player.phone}</p>
          <p className="text-sm text-gray-500">{player.country}</p>
        </div>
      </div>

      {/* Quick links */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Play a game</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { href: '/games/wingu-crash', label: 'WINGU CRASH', color: '#00F2FE', icon: <TrendingUp size={20} /> },
            { href: '/games/wingu-mines', label: 'WINGU MINES', color: '#80508B', icon: <Gem size={20} /> },
            { href: '/games/wingu-dice', label: 'WINGU DICE', color: '#00C896', icon: <Dice6 size={20} /> },
          ].map(g => (
            <Link
              key={g.href}
              href={g.href}
              className="bg-game-card border border-game-border rounded-xl p-4 flex flex-col items-center gap-2 hover:border-gray-500 transition-colors"
            >
              <span className="text-2xl">{g.icon}</span>
              <span className="text-xs font-mono font-bold" style={{ color: g.color }}>{g.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
