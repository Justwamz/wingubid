'use client'
import { useEffect, useState, useCallback } from 'react'
import { isAuthenticated, clearToken } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'

interface Stats {
  totalPlayers: number
  totalDeposits: number
  totalBetVolume: number
  totalPaidOut: number
  houseRevenue: number
  totalHeldBalance: number
  totalBets: number
  recentBets: {
    id: string
    playerName: string
    gameType: string
    grossStake: number
    winnings: number | null
    status: string
    createdAt: string
  }[]
}

function kes(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

const STATUS_COLORS: Record<string, string> = {
  won: 'text-green-400',
  lost: 'text-red-400',
  active: 'text-yellow-400',
  refunded: 'text-gray-400',
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchStats = useCallback(async () => {
    const { data } = await apiFetch<Stats>('/admin/stats')
    if (data) {
      setStats(data)
      setLastUpdated(new Date())
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/login'); return }
    fetchStats()
    const interval = setInterval(fetchStats, 30_000)
    return () => clearInterval(interval)
  }, [router, fetchStats])

  function handleLogout() {
    clearToken()
    router.push('/login')
  }

  const statCards = stats ? [
    { label: 'Total Players', value: stats.totalPlayers.toLocaleString(), color: 'text-blue-400', icon: '👥' },
    { label: 'Total Bets', value: stats.totalBets.toLocaleString(), color: 'text-purple-400', icon: '🎲' },
    { label: 'Bet Volume', value: kes(stats.totalBetVolume), color: 'text-cyan-400', icon: '📊' },
    { label: 'Paid Out', value: kes(stats.totalPaidOut), color: 'text-orange-400', icon: '💸' },
    { label: 'House Revenue', value: kes(stats.houseRevenue), color: stats.houseRevenue >= 0 ? 'text-green-400' : 'text-red-400', icon: '🏦' },
    { label: 'Deposits (real)', value: kes(stats.totalDeposits), color: 'text-emerald-400', icon: '💰' },
    { label: 'Balance Held', value: kes(stats.totalHeldBalance), color: 'text-yellow-400', icon: '🏧' },
  ] : []

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">
            <span className="text-cyan-400">WINGU</span>
            <span className="text-violet-400">BET</span>
            <span className="text-gray-400 font-normal text-base ml-3">Admin</span>
          </h1>
          {lastUpdated && (
            <p className="text-xs text-gray-600 mt-1">
              Last updated: {lastUpdated.toLocaleTimeString()} · auto-refreshes every 30s
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchStats}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 transition-colors"
          >
            ↻ Refresh
          </button>
          <button
            onClick={handleLogout}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 transition-colors"
          >
            Log out
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-500">Loading stats…</div>
      ) : !stats ? (
        <div className="flex items-center justify-center h-64 text-red-400">Failed to load stats</div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {statCards.map(c => (
              <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{c.icon}</span>
                  <span className="text-xs text-gray-500 uppercase tracking-wide">{c.label}</span>
                </div>
                <p className={`text-lg font-bold font-mono ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* Recent bets */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
              <h2 className="font-semibold text-sm">Recent Bets</h2>
              <span className="text-xs text-gray-500">{stats.recentBets.length} shown</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                    <th className="text-left px-5 py-3">Player</th>
                    <th className="text-left px-5 py-3">Game</th>
                    <th className="text-right px-5 py-3">Stake</th>
                    <th className="text-right px-5 py-3">Winnings</th>
                    <th className="text-left px-5 py-3">Status</th>
                    <th className="text-left px-5 py-3">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentBets.map(b => (
                    <tr key={b.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 py-3 font-medium">{b.playerName}</td>
                      <td className="px-5 py-3 uppercase text-xs font-mono text-gray-400">{b.gameType}</td>
                      <td className="px-5 py-3 text-right font-mono text-gray-300">{kes(b.grossStake)}</td>
                      <td className="px-5 py-3 text-right font-mono">
                        {b.winnings !== null ? (
                          <span className={b.winnings > 0 ? 'text-green-400' : 'text-gray-500'}>{kes(b.winnings)}</span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className={`px-5 py-3 capitalize font-semibold text-xs ${STATUS_COLORS[b.status] ?? 'text-gray-400'}`}>
                        {b.status}
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {new Date(b.createdAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                  {stats.recentBets.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-gray-600">No bets yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </main>
  )
}
