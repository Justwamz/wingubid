'use client'
import { useEffect, useState, useCallback } from 'react'
import { isAuthenticated, clearToken } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { UsersTab } from '@/components/UsersTab'
import { TransactionsTab } from '@/components/TransactionsTab'
import { Users, Dice6, BarChart3, ArrowDownCircle, Landmark, DollarSign, Wallet, RefreshCw } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

type Placement = 'landing' | 'lobby'

interface Banner {
  id: string
  placement: Placement
  headline: string
  subtext: string
  ctaText: string
  ctaUrl: string
  imageUrl: string
  gradient: string
  active: boolean
  createdAt: string
}

interface BannersResponse {
  banners: Banner[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kes(cents: number) {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`
}

const STATUS_COLORS: Record<string, string> = {
  won: 'text-green-400',
  lost: 'text-red-400',
  active: 'text-yellow-400',
  refunded: 'text-gray-400',
}

// ---------------------------------------------------------------------------
// Gradient presets
// ---------------------------------------------------------------------------

const GRADIENT_PRESETS = [
  { label: 'Cyan / Violet', value: 'from-cyan-900/60 to-violet-900/40' },
  { label: 'Violet / Cyan', value: 'from-violet-900/60 to-cyan-900/40' },
  { label: 'Emerald / Cyan', value: 'from-emerald-900/60 to-cyan-900/40' },
  { label: 'Orange / Rose', value: 'from-orange-900/60 to-rose-900/40' },
  { label: 'Amber / Yellow', value: 'from-amber-900/60 to-yellow-900/40' },
]

/** Swatch preview colours (approximate visual for the picker UI) */
const SWATCH_COLORS: Record<string, string> = {
  'from-cyan-900/60 to-violet-900/40': 'linear-gradient(to right, #164e63, #4c1d95)',
  'from-violet-900/60 to-cyan-900/40': 'linear-gradient(to right, #4c1d95, #164e63)',
  'from-emerald-900/60 to-cyan-900/40': 'linear-gradient(to right, #064e3b, #164e63)',
  'from-orange-900/60 to-rose-900/40': 'linear-gradient(to right, #7c2d12, #881337)',
  'from-amber-900/60 to-yellow-900/40': 'linear-gradient(to right, #78350f, #713f12)',
}

// ---------------------------------------------------------------------------
// Banner preview component
// ---------------------------------------------------------------------------

function BannerPreview({ form }: { form: NewBannerForm }) {
  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-gradient-to-r ${form.gradient} border border-white/10 p-6 flex items-center gap-6`}
      style={{ minHeight: '120px' }}
    >
      {form.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={form.imageUrl}
          alt="banner"
          className="h-20 w-auto object-contain rounded-lg flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-white text-lg leading-tight truncate">
          {form.headline || <span className="text-gray-500 italic">Headline…</span>}
        </p>
        {form.subtext && (
          <p className="text-sm text-gray-300 mt-1 line-clamp-2">{form.subtext}</p>
        )}
        {form.ctaText && (
          <button className="mt-3 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs px-4 py-1.5 rounded-full transition-colors">
            {form.ctaText}
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// New-banner form state
// ---------------------------------------------------------------------------

interface NewBannerForm {
  headline: string
  subtext: string
  ctaText: string
  ctaUrl: string
  imageUrl: string
  gradient: string
}

function defaultForm(placement: Placement): NewBannerForm {
  return {
    headline: '',
    subtext: '',
    ctaText: '',
    ctaUrl: placement === 'landing' ? '/register' : '/wallet/deposit',
    imageUrl: '',
    gradient: GRADIENT_PRESETS[0].value,
  }
}

// ---------------------------------------------------------------------------
// BannerSection (Landing or Lobby)
// ---------------------------------------------------------------------------

function BannerSection({
  placement,
  banners,
  onActivate,
  onDelete,
  onCreate,
}: {
  placement: Placement
  banners: Banner[]
  onActivate: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onCreate: (placement: Placement, form: NewBannerForm) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<NewBannerForm>(() => defaultForm(placement))
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  function update<K extends keyof NewBannerForm>(k: K, v: NewBannerForm[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.headline.trim()) return
    setSaving(true)
    await onCreate(placement, form)
    setForm(defaultForm(placement))
    setOpen(false)
    setSaving(false)
  }

  async function handleActivate(id: string) {
    setActionLoading(id + '_activate')
    await onActivate(id)
    setActionLoading(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this banner?')) return
    setActionLoading(id + '_delete')
    await onDelete(id)
    setActionLoading(null)
  }

  const placementBanners = banners.filter(b => b.placement === placement)
  const title = placement === 'landing' ? 'Landing' : 'Lobby'

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">{title}</h3>

      {/* Banner table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {placementBanners.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-600 text-sm">No banners yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                  <th className="text-left px-5 py-3">Headline</th>
                  <th className="text-left px-5 py-3">Active</th>
                  <th className="text-left px-5 py-3">CTA Text</th>
                  <th className="text-left px-5 py-3">Created</th>
                  <th className="text-left px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {placementBanners.map(b => (
                  <tr key={b.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-3 font-medium max-w-xs truncate">{b.headline}</td>
                    <td className="px-5 py-3">
                      {b.active ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-900/50 text-green-400 border border-green-700/50">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-800 text-gray-500 border border-gray-700">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-400">{b.ctaText || <span className="text-gray-600 italic text-xs">none</span>}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {new Date(b.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {!b.active && (
                          <button
                            onClick={() => handleActivate(b.id)}
                            disabled={actionLoading === b.id + '_activate'}
                            className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50 transition-colors"
                          >
                            {actionLoading === b.id + '_activate' ? '…' : 'Activate'}
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(b.id)}
                          disabled={actionLoading === b.id + '_delete'}
                          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
                        >
                          {actionLoading === b.id + '_delete' ? '…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New banner toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
      >
        <span className={`text-lg leading-none transition-transform ${open ? 'rotate-45' : ''}`}>+</span>
        {open ? 'Cancel' : 'New Banner'}
      </button>

      {open && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Headline */}
            <div>
              <div className="flex justify-between items-baseline mb-1">
                <label className="text-xs text-gray-400">Headline</label>
                <span className="text-xs text-gray-600">{form.headline.length}/80</span>
              </div>
              <input
                type="text"
                value={form.headline}
                onChange={e => update('headline', e.target.value.slice(0, 80))}
                placeholder="Win big every day"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600"
              />
            </div>

            {/* Subtext */}
            <div>
              <div className="flex justify-between items-baseline mb-1">
                <label className="text-xs text-gray-400">Subtext</label>
                <span className="text-xs text-gray-600">{form.subtext.length}/160</span>
              </div>
              <textarea
                value={form.subtext}
                onChange={e => update('subtext', e.target.value.slice(0, 160))}
                placeholder="Place your bets and multiply your money."
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 resize-none"
              />
            </div>

            {/* CTA text + URL */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between items-baseline mb-1">
                  <label className="text-xs text-gray-400">CTA Button Text</label>
                  <span className="text-xs text-gray-600">{form.ctaText.length}/40</span>
                </div>
                <input
                  type="text"
                  value={form.ctaText}
                  onChange={e => update('ctaText', e.target.value.slice(0, 40))}
                  placeholder="Play Now"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">CTA URL</label>
                <input
                  type="text"
                  value={form.ctaUrl}
                  onChange={e => update('ctaUrl', e.target.value)}
                  placeholder="/register"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600"
                />
              </div>
            </div>

            {/* Image URL */}
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Banner image URL
                <span className="text-gray-600 ml-1">
                  · Recommended: 1200×300px · Ratio 4:1 · Max 500KB · PNG or JPG
                </span>
              </label>
              <input
                type="url"
                value={form.imageUrl}
                onChange={e => update('imageUrl', e.target.value)}
                placeholder="https://cdn.example.com/banner.png"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600"
              />
            </div>

            {/* Gradient picker */}
            <div>
              <label className="text-xs text-gray-400 block mb-2">Gradient Preset</label>
              <div className="flex gap-3">
                {GRADIENT_PRESETS.map(preset => (
                  <button
                    key={preset.value}
                    type="button"
                    title={preset.label}
                    onClick={() => update('gradient', preset.value)}
                    className={`w-10 h-10 rounded-lg border-2 transition-all ${
                      form.gradient === preset.value
                        ? 'border-cyan-400 scale-110'
                        : 'border-transparent hover:border-gray-600'
                    }`}
                    style={{ background: SWATCH_COLORS[preset.value] }}
                  />
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={saving || !form.headline.trim()}
              className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm py-2 rounded-lg transition-colors"
            >
              {saving ? 'Creating…' : 'Create Banner'}
            </button>
          </form>

          {/* Live preview */}
          <div>
            <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Live Preview</p>
            <BannerPreview form={form} />
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminDashboardPage() {
  const router = useRouter()
  const [tab, setTab] = useState<'stats' | 'promotions' | 'users' | 'transactions'>('stats')
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Promotions state
  const [banners, setBanners] = useState<Banner[]>([])
  const [bannersLoading, setBannersLoading] = useState(false)
  const [bannersError, setBannersError] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    const { data } = await apiFetch<Stats>('/admin/stats')
    if (data) {
      setStats(data)
      setLastUpdated(new Date())
    }
    setLoading(false)
  }, [])

  const fetchBanners = useCallback(async () => {
    setBannersLoading(true)
    setBannersError(null)
    const { data, error } = await apiFetch<BannersResponse>('/admin/banners')
    if (data) {
      setBanners(data.banners)
    } else {
      setBannersError(error?.message ?? 'Failed to load banners')
    }
    setBannersLoading(false)
  }, [])

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/login'); return }
    fetchStats()
    const interval = setInterval(fetchStats, 30_000)
    return () => clearInterval(interval)
  }, [router, fetchStats])

  useEffect(() => {
    if (tab === 'promotions') {
      fetchBanners()
    }
  }, [tab, fetchBanners])

  function handleLogout() {
    clearToken()
    router.push('/login')
  }

  async function handleActivate(id: string) {
    await apiFetch(`/admin/banners/${id}/activate`, { method: 'PUT' })
    await fetchBanners()
  }

  async function handleDelete(id: string) {
    await apiFetch(`/admin/banners/${id}`, { method: 'DELETE' })
    await fetchBanners()
  }

  async function handleCreate(placement: Placement, form: NewBannerForm) {
    await apiFetch('/admin/banners', {
      method: 'POST',
      body: JSON.stringify({ placement, ...form }),
    })
    await fetchBanners()
  }

  const statCards = stats ? [
    { label: 'Total Players', value: stats.totalPlayers.toLocaleString(), color: 'text-blue-400', icon: <Users size={16} /> },
    { label: 'Total Bets', value: stats.totalBets.toLocaleString(), color: 'text-purple-400', icon: <Dice6 size={16} /> },
    { label: 'Bet Volume', value: kes(stats.totalBetVolume), color: 'text-cyan-400', icon: <BarChart3 size={16} /> },
    { label: 'Paid Out', value: kes(stats.totalPaidOut), color: 'text-orange-400', icon: <ArrowDownCircle size={16} /> },
    { label: 'House Revenue', value: kes(stats.houseRevenue), color: stats.houseRevenue >= 0 ? 'text-green-400' : 'text-red-400', icon: <Landmark size={16} /> },
    { label: 'Deposits (real)', value: kes(stats.totalDeposits), color: 'text-emerald-400', icon: <DollarSign size={16} /> },
    { label: 'Balance Held', value: kes(stats.totalHeldBalance), color: 'text-yellow-400', icon: <Wallet size={16} /> },
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
            <RefreshCw size={12} className="inline mr-1" /> Refresh
          </button>
          <button
            onClick={handleLogout}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 transition-colors"
          >
            Log out
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {(['stats', 'promotions', 'users', 'transactions'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Stats tab */}
      {tab === 'stats' && (
        loading ? (
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
                            <span className="text-gray-600 italic text-xs">pending</span>
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
        )
      )}

      {/* Promotions tab */}
      {tab === 'promotions' && (
        <div className="space-y-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Banner Management</h2>
            <button
              onClick={fetchBanners}
              disabled={bannersLoading}
              className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {bannersLoading ? 'Loading…' : <><RefreshCw size={12} className="inline mr-1" /> Refresh</>}
            </button>
          </div>

          {bannersError && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-400">
              {bannersError}
            </div>
          )}

          <BannerSection
            placement="landing"
            banners={banners}
            onActivate={handleActivate}
            onDelete={handleDelete}
            onCreate={handleCreate}
          />

          <BannerSection
            placement="lobby"
            banners={banners}
            onActivate={handleActivate}
            onDelete={handleDelete}
            onCreate={handleCreate}
          />
        </div>
      )}
      {tab === 'users' && <UsersTab />}
      {tab === 'transactions' && <TransactionsTab />}
    </main>
  )
}
