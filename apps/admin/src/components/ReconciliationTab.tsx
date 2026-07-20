'use client'
import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { RefreshCw } from 'lucide-react'

type Status = 'credited' | 'unresolved' | 'reposted' | 'refunded'

interface Payment {
  id: string
  msisdn: string
  amount: number
  mpesaReceipt: string
  status: Status
  playerPhone: string | null
  resolvedAt: string | null
  createdAt: string
}
interface Totals { uncredited: number; refunded: number; credited: number }
interface Response { payments: Payment[]; totals: Totals }

function kes(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

const STATUS_STYLE: Record<Status, string> = {
  credited: 'text-green-400',
  reposted: 'text-cyan-400',
  unresolved: 'text-yellow-400',
  refunded: 'text-gray-400',
}

export function ReconciliationTab() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [totals, setTotals] = useState<Totals>({ uncredited: 0, refunded: 0, credited: 0 })
  const [loading, setLoading] = useState(true)
  const [phones, setPhones] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await apiFetch<Response>('/admin/c2b-payments')
    if (data) { setPayments(data.payments); setTotals(data.totals) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function repost(id: string) {
    const phone = (phones[id] ?? '').trim()
    if (!phone) { setError('Enter the user\'s phone number to credit.'); return }
    setBusy(id); setError(null)
    const { error: err } = await apiFetch(`/admin/c2b-payments/${id}/repost`, {
      method: 'POST', body: JSON.stringify({ phone }),
    })
    setBusy(null)
    if (err) { setError(err.message); return }
    load()
  }

  async function refund(id: string) {
    if (!confirm('Mark this payment as refunded? This records the decision for reconciliation.')) return
    setBusy(id); setError(null)
    const { error: err } = await apiFetch(`/admin/c2b-payments/${id}/refund`, {
      method: 'POST', body: JSON.stringify({}),
    })
    setBusy(null)
    if (err) { setError(err.message); return }
    load()
  }

  const cards = [
    { label: 'Uncredited (held)', value: totals.uncredited, color: 'text-yellow-400' },
    { label: 'Refunded', value: totals.refunded, color: 'text-gray-300' },
    { label: 'Credited', value: totals.credited, color: 'text-green-400' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Paybill Reconciliation</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Direct paybill (C2B) payments. Matched numbers are credited automatically; unmatched ones are held for you to repost or refund.
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 disabled:opacity-50 transition-colors">
          {loading ? 'Loading…' : <><RefreshCw size={12} className="inline mr-1" /> Refresh</>}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map(c => (
          <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{c.label}</p>
            <p className={`text-xl font-bold font-mono ${c.color}`}>{kes(c.value)}</p>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded px-3 py-2">{error}</p>}

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Payer</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="text-left px-4 py-3">Receipt</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{new Date(p.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono">{p.msisdn}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-300">{kes(p.amount)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{p.mpesaReceipt}</td>
                  <td className={`px-4 py-3 capitalize font-semibold text-xs ${STATUS_STYLE[p.status]}`}>{p.status}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{p.playerPhone ?? '-'}</td>
                  <td className="px-4 py-3">
                    {p.status === 'unresolved' ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={phones[p.id] ?? ''}
                          onChange={e => setPhones(prev => ({ ...prev, [p.id]: e.target.value }))}
                          placeholder="User phone"
                          className="w-32 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-cyan-600"
                        />
                        <button onClick={() => repost(p.id)} disabled={busy === p.id}
                          className="rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold px-2.5 py-1 transition-colors">
                          Credit
                        </button>
                        <button onClick={() => refund(p.id)} disabled={busy === p.id}
                          className="rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 text-xs px-2.5 py-1 transition-colors">
                          Refund
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-600 text-xs">
                        {p.resolvedAt ? `resolved ${new Date(p.resolvedAt).toLocaleDateString()}` : '-'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-600">{loading ? 'Loading…' : 'No paybill payments yet'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
