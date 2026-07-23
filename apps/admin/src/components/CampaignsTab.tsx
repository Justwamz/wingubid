'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface Criteria {
  registeredWithinDays?: number
  depositStatus?: 'has' | 'none'
  minTotalDepositCents?: number
  bettingActivity?: 'has' | 'none'
}

interface CampaignRow {
  id: string; key: string; name: string; description: string | null; type: string
  amount_cents: number; expiry_days: number | null; starts_at: string | null; ends_at: string | null
  status: string; claim_count: number; code: string | null; criteria: Criteria | null
  reward_kind?: 'fixed' | 'deposit_match' | null
  match_percent?: number | null; max_match_cents?: number | null; min_deposit_cents?: number | null
}

const STATUSES = ['active', 'paused', 'ended'] as const

function kes(cents: number) { return `KES ${(cents / 100).toLocaleString('en-KE')}` }

function rewardSummary(c: CampaignRow): string {
  if (c.reward_kind === 'deposit_match') {
    return `${c.match_percent}% up to ${kes(c.max_match_cents ?? 0)}, min ${kes(c.min_deposit_cents ?? 0)}`
  }
  return kes(c.amount_cents)
}

function criteriaSummary(c: Criteria | null | undefined): string {
  if (!c) return ''
  const parts: string[] = []
  if (c.registeredWithinDays) parts.push(`registered <=${c.registeredWithinDays}d`)
  if (c.depositStatus) parts.push(`deposit: ${c.depositStatus}`)
  if (c.minTotalDepositCents) parts.push(`min deposit ${kes(c.minTotalDepositCents)}`)
  if (c.bettingActivity) parts.push(`betting: ${c.bettingActivity}`)
  return parts.join(', ')
}

const emptyForm = {
  key: '', name: '', description: '', type: 'welcome', amount: '', expiryDays: '', startsAt: '', endsAt: '',
  code: '', registeredWithinDays: '', depositStatus: '', minTotalDepositCents: '', bettingActivity: '',
  rewardKind: 'fixed' as 'fixed' | 'deposit_match', matchPercent: '', maxMatch: '', minDeposit: '',
}

function buildCriteria(form: typeof emptyForm): Criteria | undefined {
  const c: Criteria = {}
  if (form.registeredWithinDays) c.registeredWithinDays = parseInt(form.registeredWithinDays)
  if (form.depositStatus) c.depositStatus = form.depositStatus as 'has' | 'none'
  if (form.minTotalDepositCents) c.minTotalDepositCents = Math.round(parseFloat(form.minTotalDepositCents) * 100)
  if (form.bettingActivity) c.bettingActivity = form.bettingActivity as 'has' | 'none'
  return Object.keys(c).length ? c : undefined
}

export function CampaignsTab() {
  const [rows, setRows] = useState<CampaignRow[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyForm)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null)
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await apiFetch<{ campaigns: CampaignRow[] }>('/admin/campaigns')
    if (data) setRows(data.campaigns)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const criteria = buildCriteria(form)
    if (!criteria) { setPreviewCount(null); setPreviewLoading(false); return }
    setPreviewLoading(true)
    const timer = setTimeout(async () => {
      const { data } = await apiFetch<{ count: number }>('/admin/campaigns/preview-count', {
        method: 'POST', body: JSON.stringify({ criteria }),
      })
      setPreviewLoading(false)
      if (data) setPreviewCount(data.count)
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.registeredWithinDays, form.depositStatus, form.minTotalDepositCents, form.bettingActivity])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const body: Record<string, unknown> = {
      key: form.key.trim(),
      name: form.name.trim(),
    }
    if (form.rewardKind === 'deposit_match') {
      body.type = 'deposit_match'
      body.rewardKind = 'deposit_match'
      body.matchPercent = parseInt(form.matchPercent)
      body.maxMatchCents = Math.round(parseFloat(form.maxMatch) * 100)
      body.minDepositCents = Math.round(parseFloat(form.minDeposit) * 100)
    } else {
      body.type = form.type
      body.rewardKind = 'fixed'
      body.amountCents = Math.round(parseFloat(form.amount) * 100)
    }
    if (form.description.trim()) body.description = form.description.trim()
    if (form.expiryDays) body.expiryDays = parseInt(form.expiryDays)
    if (form.startsAt) body.startsAt = new Date(form.startsAt).toISOString()
    if (form.endsAt) body.endsAt = new Date(form.endsAt).toISOString()
    if (form.code.trim()) body.code = form.code.trim().toUpperCase()
    const criteria = buildCriteria(form)
    if (criteria) body.criteria = criteria

    const { error } = await apiFetch('/admin/campaigns', { method: 'POST', body: JSON.stringify(body) })
    setBusy(false)
    setMsg(error ? error.message : 'Campaign created.')
    if (!error) { setForm(emptyForm); setPreviewCount(null); await load() }
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
        <input placeholder="Promo code (optional)" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm uppercase placeholder:normal-case" />
        <textarea placeholder="Description (optional)" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
          rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none" />
        <div>
          <label className="text-xs text-gray-500 block mb-1">Reward kind</label>
          <select value={form.rewardKind} onChange={e => setForm({ ...form, rewardKind: e.target.value as 'fixed' | 'deposit_match' })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="fixed">Fixed amount</option>
            <option value="deposit_match">Deposit match</option>
          </select>
        </div>
        {form.rewardKind === 'fixed' && (
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="welcome">Welcome</option>
            <option value="custom">Custom</option>
          </select>
        )}
        {form.rewardKind === 'fixed' ? (
          <input required type="number" step="0.01" placeholder="Amount (KES)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
        ) : (
          <>
            <input required type="number" step="1" min="1" max="100" placeholder="Match % (1-100)" value={form.matchPercent}
              onChange={e => setForm({ ...form, matchPercent: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <input required type="number" step="0.01" placeholder="Max match (KES)" value={form.maxMatch}
              onChange={e => setForm({ ...form, maxMatch: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <input required type="number" step="0.01" placeholder="Min deposit (KES)" value={form.minDeposit}
              onChange={e => setForm({ ...form, minDeposit: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          </>
        )}
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

        <div className="border-t border-gray-800 pt-3 space-y-2">
          <h4 className="text-xs font-semibold text-gray-400 uppercase">Targeting</h4>
          <input type="number" placeholder="Registered within days (optional)" value={form.registeredWithinDays}
            onChange={e => setForm({ ...form, registeredWithinDays: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Deposit status</label>
              <select value={form.depositStatus} onChange={e => setForm({ ...form, depositStatus: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Any</option>
                <option value="has">Has deposited</option>
                <option value="none">No deposit</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Betting activity</label>
              <select value={form.bettingActivity} onChange={e => setForm({ ...form, bettingActivity: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Any</option>
                <option value="has">Has bet</option>
                <option value="none">Never bet</option>
              </select>
            </div>
          </div>
          <input type="number" step="0.01" placeholder="Min total deposit KES (optional)" value={form.minTotalDepositCents}
            onChange={e => setForm({ ...form, minTotalDepositCents: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          <div className="text-xs text-gray-500">
            {previewLoading ? 'Checking match count...'
              : previewCount !== null ? `Matches ${previewCount} players`
              : 'Set targeting fields to preview the matching players.'}
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
            <th className="text-right px-4 py-3">Reward</th><th className="text-left px-4 py-3">Expiry</th>
            <th className="text-left px-4 py-3">Window</th><th className="text-left px-4 py-3">Status</th>
            <th className="text-right px-4 py-3">Claims</th><th className="text-left px-4 py-3">Actions</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-600">Loading...</td></tr>
            : rows.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-600">No campaigns yet</td></tr>
            : rows.map(c => (
              <tr key={c.id} className="border-b border-gray-800/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span>{c.name}</span>
                    {c.code && (
                      <span className="font-mono text-[10px] bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-cyan-300">
                        {c.code}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">{c.key}</div>
                  {criteriaSummary(c.criteria) && (
                    <div className="text-xs text-gray-600 mt-0.5">{criteriaSummary(c.criteria)}</div>
                  )}
                </td>
                <td className="px-4 py-3 capitalize text-gray-400">{c.type}</td>
                <td className="px-4 py-3 text-right font-mono">{rewardSummary(c)}</td>
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
