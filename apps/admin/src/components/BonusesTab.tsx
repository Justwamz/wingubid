'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface BonusRow {
  id: string; amount_granted: number; remaining: number; status: string
  expires_at: string | null; created_at: string; player_name: string; player_phone: string
}

function kes(cents: number) { return `KES ${(cents / 100).toLocaleString('en-KE')}` }

export function BonusesTab() {
  const [rows, setRows] = useState<BonusRow[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ phone: '', amount: '', expiresInDays: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await apiFetch<{ bonuses: BonusRow[] }>('/admin/bonuses')
    if (data) setRows(data.bonuses)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function grant(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const body: Record<string, unknown> = { phone: form.phone.trim(), amountCents: Math.round(parseFloat(form.amount) * 100) }
    if (form.expiresInDays) body.expiresInDays = parseInt(form.expiresInDays)
    const { error } = await apiFetch('/admin/bonuses/grant', { method: 'POST', body: JSON.stringify(body) })
    setBusy(false)
    setMsg(error ? error.message : 'Bonus granted.')
    if (!error) { setForm({ phone: '', amount: '', expiresInDays: '' }); await load() }
  }

  return (
    <div className="space-y-6">
      {msg && <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-cyan-300">{msg}</div>}

      <form onSubmit={grant} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3 max-w-md">
        <h3 className="font-semibold text-sm">Grant a bonus</h3>
        <input required placeholder="Player phone (e.g. +254700000001)" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <input required type="number" step="0.01" placeholder="Amount (KES)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <input type="number" placeholder="Expires in days (default 30)" value={form.expiresInDays} onChange={e => setForm({ ...form, expiresInDays: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <button type="submit" disabled={busy} className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm py-2 rounded-lg">
          {busy ? 'Granting...' : 'Grant bonus'}
        </button>
      </form>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
            <th className="text-left px-4 py-3">Player</th><th className="text-left px-4 py-3">Phone</th>
            <th className="text-right px-4 py-3">Granted</th><th className="text-right px-4 py-3">Remaining</th>
            <th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">Expires</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">Loading...</td></tr>
            : rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">No bonuses yet</td></tr>
            : rows.map(b => (
              <tr key={b.id} className="border-b border-gray-800/50">
                <td className="px-4 py-3">{b.player_name}</td>
                <td className="px-4 py-3 text-gray-400">{b.player_phone}</td>
                <td className="px-4 py-3 text-right font-mono">{kes(b.amount_granted)}</td>
                <td className="px-4 py-3 text-right font-mono">{kes(b.remaining)}</td>
                <td className="px-4 py-3">{b.status}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{b.expires_at ? new Date(b.expires_at).toLocaleDateString() : 'never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
