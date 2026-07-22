'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface CampaignRow {
  id: string; key: string; name: string; description: string | null; type: string
  amount_cents: number; expiry_days: number | null; starts_at: string | null; ends_at: string | null
  status: string; claim_count: number
}

const STATUSES = ['active', 'paused', 'ended'] as const

function kes(cents: number) { return `KES ${(cents / 100).toLocaleString('en-KE')}` }

const emptyForm = { key: '', name: '', description: '', type: 'welcome', amount: '', expiryDays: '', startsAt: '', endsAt: '' }

export function CampaignsTab() {
  const [rows, setRows] = useState<CampaignRow[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyForm)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await apiFetch<{ campaigns: CampaignRow[] }>('/admin/campaigns')
    if (data) setRows(data.campaigns)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const body: Record<string, unknown> = {
      key: form.key.trim(),
      name: form.name.trim(),
      type: form.type,
      amountCents: Math.round(parseFloat(form.amount) * 100),
    }
    if (form.description.trim()) body.description = form.description.trim()
    if (form.expiryDays) body.expiryDays = parseInt(form.expiryDays)
    if (form.startsAt) body.startsAt = new Date(form.startsAt).toISOString()
    if (form.endsAt) body.endsAt = new Date(form.endsAt).toISOString()

    const { error } = await apiFetch('/admin/campaigns', { method: 'POST', body: JSON.stringify(body) })
    setBusy(false)
    setMsg(error ? error.message : 'Campaign created.')
    if (!error) { setForm(emptyForm); await load() }
  }

  async function setStatus(id: string, status: string) {
    setStatusBusyId(id)
    const { error } = await apiFetch(`/admin/campaigns/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) })
    setStatusBusyId(null)
    if (error) setMsg(error.message)
    else await load()
  }

  return (
    <div className="space-y-6">
      {msg && <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-cyan-300">{msg}</div>}

      <form onSubmit={create} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3 max-w-md">
        <h3 className="font-semibold text-sm">Create a campaign</h3>
        <input required placeholder="Key (e.g. welcome_bonus)" value={form.key} onChange={e => setForm({ ...form, key: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <input required placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <textarea placeholder="Description (optional)" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
          rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
          <option value="welcome">Welcome</option>
          <option value="custom">Custom</option>
        </select>
        <input required type="number" step="0.01" placeholder="Amount (KES)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <input type="number" placeholder="Expiry in days (optional)" value={form.expiryDays} onChange={e => setForm({ ...form, expiryDays: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Starts at (optional)</label>
            <input type="datetime-local" value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Ends at (optional)</label>
            <input type="datetime-local" value={form.endsAt} onChange={e => setForm({ ...form, endsAt: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <button type="submit" disabled={busy} className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm py-2 rounded-lg">
          {busy ? 'Creating...' : 'Create campaign'}
        </button>
      </form>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
            <th className="text-left px-4 py-3">Name</th><th className="text-left px-4 py-3">Type</th>
            <th className="text-right px-4 py-3">Amount</th><th className="text-left px-4 py-3">Expiry</th>
            <th className="text-left px-4 py-3">Window</th><th className="text-left px-4 py-3">Status</th>
            <th className="text-right px-4 py-3">Claims</th><th className="text-left px-4 py-3">Actions</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-600">Loading...</td></tr>
            : rows.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-600">No campaigns yet</td></tr>
            : rows.map(c => (
              <tr key={c.id} className="border-b border-gray-800/50">
                <td className="px-4 py-3">
                  <div>{c.name}</div>
                  <div className="text-xs text-gray-500">{c.key}</div>
                </td>
                <td className="px-4 py-3 capitalize text-gray-400">{c.type}</td>
                <td className="px-4 py-3 text-right font-mono">{kes(c.amount_cents)}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{c.expiry_days ? `${c.expiry_days} days` : 'never'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {c.starts_at ? new Date(c.starts_at).toLocaleDateString() : 'any'}
                  {' - '}
                  {c.ends_at ? new Date(c.ends_at).toLocaleDateString() : 'any'}
                </td>
                <td className="px-4 py-3 capitalize">{c.status}</td>
                <td className="px-4 py-3 text-right font-mono">{c.claim_count}</td>
                <td className="px-4 py-3">
                  <select
                    value={c.status}
                    disabled={statusBusyId === c.id}
                    onChange={e => setStatus(c.id, e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs disabled:opacity-50"
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
