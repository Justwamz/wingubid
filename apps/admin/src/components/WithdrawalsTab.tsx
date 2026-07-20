'use client'
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { RefreshCw } from 'lucide-react'

interface Withdrawal {
  id: string
  player_name: string
  phone: string
  amount: number
  status: string
  provider: string
  created_at: string
  updated_at: string | null
}

function kes(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-green-900/50 text-green-400 border border-green-700/50',
  pending:   'bg-yellow-900/50 text-yellow-400 border border-yellow-700/50',
  failed:    'bg-red-900/50 text-red-400 border border-red-700/50',
  awaiting_callback: 'bg-blue-900/50 text-blue-400 border border-blue-700/50',
}

export function WithdrawalsTab() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'failed' | 'completed' | 'pending'>('all')

  const fetchWithdrawals = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: apiError } = await apiFetch<{ withdrawals: Withdrawal[] }>('/admin/withdrawals')
    if (data) setWithdrawals(data.withdrawals)
    else setError(apiError?.message ?? 'Failed to load withdrawals')
    setLoading(false)
  }, [])

  useEffect(() => { fetchWithdrawals() }, [fetchWithdrawals])

  async function handleRetry(id: string) {
    setRetrying(id)
    const { error: err } = await apiFetch(`/admin/withdrawals/${id}/retry`, { method: 'POST' })
    setRetrying(null)
    if (err) { alert(err.message); return }
    fetchWithdrawals()
  }

  const filtered = filter === 'all' ? withdrawals : withdrawals.filter(w => w.status === filter)
  const failedCount = withdrawals.filter(w => w.status === 'failed').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Withdrawals</h2>
          {failedCount > 0 && (
            <p className="text-xs text-red-400 mt-0.5">{failedCount} failed - review and retry</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as typeof filter)}
            className="bg-gray-800 border border-gray-700 text-sm text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-600"
          >
            <option value="all">All</option>
            <option value="failed">Failed</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
          </select>
          <button
            onClick={fetchWithdrawals}
            disabled={loading}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {loading && withdrawals.length === 0 ? (
          <div className="text-center text-gray-600 text-sm py-12">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                  <th className="text-left px-5 py-3">Player</th>
                  <th className="text-left px-5 py-3">Phone</th>
                  <th className="text-right px-5 py-3">Amount</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="text-left px-5 py-3">Date</th>
                  <th className="text-left px-5 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-gray-600">No withdrawals</td>
                  </tr>
                )}
                {filtered.map(w => (
                  <tr key={w.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-3 font-medium">{w.player_name}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-400">{w.phone}</td>
                    <td className="px-5 py-3 text-right font-mono text-gray-300">{kes(w.amount)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[w.status] ?? 'bg-gray-800 text-gray-400'}`}>
                        {w.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{new Date(w.created_at).toLocaleString()}</td>
                    <td className="px-5 py-3">
                      {w.status === 'failed' && (
                        <button
                          onClick={() => handleRetry(w.id)}
                          disabled={retrying === w.id}
                          className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50 transition-colors font-semibold"
                        >
                          {retrying === w.id ? 'Retrying…' : 'Retry'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
