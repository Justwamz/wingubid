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
  awaiting_approval: 'bg-orange-900/50 text-orange-400 border border-orange-700/50',
  rejected:  'bg-gray-800 text-gray-400 border border-gray-700',
}

type Filter = 'all' | 'awaiting_approval' | 'failed' | 'completed' | 'pending'

export function WithdrawalsTab() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  // Approval threshold (edited in KES)
  const [thresholdKes, setThresholdKes] = useState('')
  const [savingThreshold, setSavingThreshold] = useState(false)
  const [thresholdMsg, setThresholdMsg] = useState<string | null>(null)

  const fetchWithdrawals = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: apiError } = await apiFetch<{ withdrawals: Withdrawal[] }>('/admin/withdrawals')
    if (data) setWithdrawals(data.withdrawals)
    else setError(apiError?.message ?? 'Failed to load withdrawals')
    setLoading(false)
  }, [])

  const fetchConfig = useCallback(async () => {
    const { data } = await apiFetch<{ approvalThreshold: number }>('/admin/withdrawal-config')
    if (data) setThresholdKes(String(Math.round(data.approvalThreshold / 100)))
  }, [])

  useEffect(() => { fetchWithdrawals(); fetchConfig() }, [fetchWithdrawals, fetchConfig])

  async function saveThreshold() {
    const kesVal = Number(thresholdKes)
    if (Number.isNaN(kesVal) || kesVal < 0) { setThresholdMsg('Enter a valid amount.'); return }
    setSavingThreshold(true); setThresholdMsg(null)
    const { error: err } = await apiFetch('/admin/withdrawal-config', {
      method: 'PUT', body: JSON.stringify({ approvalThreshold: Math.round(kesVal * 100) }),
    })
    setSavingThreshold(false)
    setThresholdMsg(err ? err.message : 'Saved.')
  }

  async function act(id: string, action: 'approve' | 'reject' | 'retry') {
    if (action === 'reject' && !confirm('Reject this withdrawal and return the funds to the player?')) return
    setBusy(id); setError(null)
    const { error: err } = await apiFetch(`/admin/withdrawals/${id}/${action}`, {
      method: 'POST', body: action === 'reject' ? JSON.stringify({}) : undefined,
    })
    setBusy(null)
    if (err) { setError(err.message); return }
    fetchWithdrawals()
  }

  const filtered = filter === 'all' ? withdrawals : withdrawals.filter(w => w.status === filter)
  const pendingApproval = withdrawals.filter(w => w.status === 'awaiting_approval').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Withdrawals</h2>
          {pendingApproval > 0 && (
            <p className="text-xs text-orange-400 mt-0.5">{pendingApproval} awaiting approval</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as Filter)}
            className="bg-gray-800 border border-gray-700 text-sm text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-600"
          >
            <option value="all">All</option>
            <option value="awaiting_approval">Awaiting approval</option>
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

      {/* Approval threshold config */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Approval threshold (KES)</label>
          <input
            type="number" min="0" step="100"
            value={thresholdKes}
            onChange={e => setThresholdKes(e.target.value)}
            className="w-40 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-600"
          />
        </div>
        <button
          onClick={saveThreshold}
          disabled={savingThreshold}
          className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
        >
          {savingThreshold ? 'Saving…' : 'Save'}
        </button>
        <p className="text-xs text-gray-500 flex-1 min-w-[12rem]">
          Withdrawals above this amount need a Finance/Super-Admin approval before payout.
          {thresholdMsg && <span className={`ml-2 ${thresholdMsg === 'Saved.' ? 'text-green-400' : 'text-red-400'}`}>{thresholdMsg}</span>}
        </p>
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
                        {w.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{new Date(w.created_at).toLocaleString()}</td>
                    <td className="px-5 py-3">
                      {w.status === 'awaiting_approval' && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => act(w.id, 'approve')}
                            disabled={busy === w.id}
                            className="rounded bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-semibold px-2.5 py-1 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => act(w.id, 'reject')}
                            disabled={busy === w.id}
                            className="rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 text-xs px-2.5 py-1 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      {w.status === 'failed' && (
                        <button
                          onClick={() => act(w.id, 'retry')}
                          disabled={busy === w.id}
                          className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50 transition-colors font-semibold"
                        >
                          {busy === w.id ? 'Working…' : 'Retry'}
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
