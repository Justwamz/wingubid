'use client'
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

interface Player {
  id: string
  name: string
  phone: string
  country: string
  balance: number
  createdAt: string
}

function maskPhone(phone: string): string {
  if (phone.length < 8) return phone
  const prefix = phone.slice(0, 5)
  const suffix = phone.slice(-3)
  return `${prefix}** *** ${suffix}`
}

function kes(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

export function UsersTab() {
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState<string | null>(null)
  const [modal, setModal] = useState<{ playerName: string; phone: string; tempPassword: string } | null>(null)
  const [resetError, setResetError] = useState<{ playerId: string; message: string } | null>(null)

  const fetchPlayers = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: apiError } = await apiFetch<{ players: Player[] }>('/admin/players')
    if (data) {
      setPlayers(data.players)
    } else {
      setError(apiError?.message ?? 'Failed to load players')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchPlayers() }, [fetchPlayers])

  async function handleResetPassword(player: Player) {
    setResetting(player.id)
    setResetError(null)
    const { data, error: apiError } = await apiFetch<{ tempPassword: string }>(
      `/admin/players/${player.id}/reset-password`,
      { method: 'POST' },
    )
    setResetting(null)
    if (data) {
      setResetError(null)
      setModal({ playerName: player.name, phone: player.phone, tempPassword: data.tempPassword })
    } else {
      setResetError({ playerId: player.id, message: apiError?.message ?? 'Reset failed' })
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Loading players…</div>
  }

  if (error) {
    return <div className="flex items-center justify-center h-64 text-red-400">{error}</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Players</h2>
        <span className="text-xs text-gray-500">{players.length} total</span>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                <th className="text-left px-5 py-3">Customer ID</th>
                <th className="text-left px-5 py-3">Name</th>
                <th className="text-left px-5 py-3">Phone</th>
                <th className="text-left px-5 py-3">Country</th>
                <th className="text-right px-5 py-3">Balance</th>
                <th className="text-left px-5 py-3">Joined</th>
                <th className="text-left px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {players.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-gray-600">No players yet</td>
                </tr>
              )}
              {players.map(p => (
                <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-gray-400">{p.id.slice(0, 8)}</td>
                  <td className="px-5 py-3 font-medium">{p.name}</td>
                  <td className="px-5 py-3 font-mono text-gray-400">{maskPhone(p.phone)}</td>
                  <td className="px-5 py-3 text-gray-400">{p.country}</td>
                  <td className="px-5 py-3 text-right font-mono text-gray-300">{kes(p.balance)}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => handleResetPassword(p)}
                      disabled={resetting === p.id}
                      className="text-xs text-yellow-400 hover:text-yellow-300 disabled:opacity-50 transition-colors"
                    >
                      {resetting === p.id ? '…' : 'Reset Password'}
                    </button>
                    {resetError?.playerId === p.id && (
                      <p className="text-xs text-red-400 mt-1">{resetError.message}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-semibold text-white">Password Reset</h3>
            <div className="space-y-1">
              <p className="text-sm text-gray-400">
                <span className="text-white font-medium">{modal.playerName}</span>
                {' · '}
                <span className="font-mono">{maskPhone(modal.phone)}</span>
              </p>
              <p className="text-xs text-gray-500">Temporary password:</p>
              <p className="font-mono text-lg tracking-widest text-cyan-400 bg-gray-800 rounded-lg px-4 py-2 text-center select-all">
                {modal.tempPassword}
              </p>
            </div>
            <p className="text-xs text-green-400">SMS sent (simulated)</p>
            <button
              onClick={() => setModal(null)}
              className="w-full bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
