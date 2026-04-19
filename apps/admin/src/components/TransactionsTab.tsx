'use client'
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

interface Transaction {
  id: string
  playerName: string
  type: string
  amount: number
  balanceAfter: number
  createdAt: string
}

type Filter = 'all' | 'deposits' | 'bets' | 'withdrawals'

const TYPE_BADGE: Record<string, string> = {
  deposit: 'bg-green-900/50 text-green-400 border border-green-700/50',
  bet_won: 'bg-green-900/50 text-green-400 border border-green-700/50',
  bet_placed: 'bg-red-900/50 text-red-400 border border-red-700/50',
  withdrawal: 'bg-red-900/50 text-red-400 border border-red-700/50',
}

const TYPE_LABEL: Record<string, string> = {
  deposit: 'Deposit',
  bet_won: 'Bet Won',
  bet_placed: 'Bet Placed',
  withdrawal: 'Withdrawal',
}

function kes(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

function matchesFilter(type: string, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'deposits') return type === 'deposit'
  if (filter === 'bets') return type === 'bet_placed' || type === 'bet_won'
  if (filter === 'withdrawals') return type === 'withdrawal'
  return true
}

export function TransactionsTab() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: apiError } = await apiFetch<{ transactions: Transaction[] }>('/admin/transactions')
    if (data) {
      setTransactions(data.transactions)
    } else {
      setError(apiError?.message ?? 'Failed to load transactions')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  const filtered = transactions.filter(t => matchesFilter(t.type, filter))

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Loading transactions…</div>
  }

  if (error) {
    return <div className="flex items-center justify-center h-64 text-red-400">{error}</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Transactions</h2>
        <div className="flex items-center gap-3">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as Filter)}
            className="bg-gray-800 border border-gray-700 text-sm text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-600"
          >
            <option value="all">All Types</option>
            <option value="deposits">Deposits</option>
            <option value="bets">Bets</option>
            <option value="withdrawals">Withdrawals</option>
          </select>
          <span className="text-xs text-gray-500">{filtered.length} shown</span>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                <th className="text-left px-5 py-3">Player</th>
                <th className="text-left px-5 py-3">Type</th>
                <th className="text-right px-5 py-3">Amount</th>
                <th className="text-right px-5 py-3">Balance After</th>
                <th className="text-left px-5 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-gray-600">No transactions</td>
                </tr>
              )}
              {filtered.map(t => (
                <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-5 py-3 font-medium">{t.playerName}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${TYPE_BADGE[t.type] ?? 'bg-gray-800 text-gray-400'}`}>
                      {TYPE_LABEL[t.type] ?? t.type}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-gray-300">{kes(t.amount)}</td>
                  <td className="px-5 py-3 text-right font-mono text-gray-400">{kes(t.balanceAfter)}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {new Date(t.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
