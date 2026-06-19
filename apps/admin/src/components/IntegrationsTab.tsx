'use client'
import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { RefreshCw, Trash2, Plus, ChevronDown, ChevronUp } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const GAME_SLUGS = ['aviator', 'aviatrix', 'jetx', 'bball-blitz', 'sun-of-egypt-4'] as const
type GameSlug = typeof GAME_SLUGS[number]

const GAME_LABELS: Record<GameSlug, string> = {
  'aviator':       'Aviator',
  'aviatrix':      'Aviatrix',
  'jetx':          'JetX',
  'bball-blitz':   'B-Ball Blitz',
  'sun-of-egypt-4':'Sun of Egypt 4',
}

interface GameMapping {
  gameSlug:          GameSlug
  providerGameId:    string
  launchUrlTemplate: string
  active:            boolean
}

interface Provider {
  id:        string
  name:      string
  slug:      string
  baseUrl:   string
  apiKey:    string
  active:    boolean
  createdAt: string
  games:     GameMapping[]
}

// ---------------------------------------------------------------------------
// Default form state
// ---------------------------------------------------------------------------

function defaultProviderForm() {
  return { name: '', slug: '', baseUrl: '', apiKey: '', apiSecret: '', active: true }
}

function defaultGameForm(): { gameSlug: GameSlug; providerGameId: string; launchUrlTemplate: string; active: boolean } {
  return { gameSlug: 'aviator', providerGameId: '', launchUrlTemplate: '', active: true }
}

// ---------------------------------------------------------------------------
// Provider card
// ---------------------------------------------------------------------------

function ProviderCard({
  provider,
  onRefresh,
}: {
  provider: Provider
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [addingGame, setAddingGame] = useState(false)
  const [gameForm, setGameForm] = useState(defaultGameForm)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const assignedSlugs = new Set(provider.games.map(g => g.gameSlug))
  const availableSlugs = GAME_SLUGS.filter(s => !assignedSlugs.has(s))

  async function handleDelete() {
    if (!confirm(`Delete provider "${provider.name}"? This will remove all its game mappings.`)) return
    setDeleting(true)
    await apiFetch(`/admin/game-providers/${provider.id}`, { method: 'DELETE' })
    onRefresh()
  }

  async function handleToggleActive() {
    await apiFetch(`/admin/game-providers/${provider.id}`, {
      method: 'PUT',
      body: JSON.stringify({ active: !provider.active }),
    })
    onRefresh()
  }

  async function handleAddGame(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await apiFetch(`/admin/game-providers/${provider.id}/games`, {
      method: 'POST',
      body: JSON.stringify(gameForm),
    })
    setGameForm(defaultGameForm)
    setAddingGame(false)
    setSaving(false)
    onRefresh()
  }

  async function handleRemoveGame(gameSlug: string) {
    if (!confirm(`Remove ${GAME_LABELS[gameSlug as GameSlug] ?? gameSlug} from this provider?`)) return
    await apiFetch(`/admin/game-providers/${provider.id}/games/${gameSlug}`, { method: 'DELETE' })
    onRefresh()
  }

  async function handleToggleGame(g: GameMapping) {
    await apiFetch(`/admin/game-providers/${provider.id}/games`, {
      method: 'POST',
      body: JSON.stringify({ ...g, active: !g.active }),
    })
    onRefresh()
  }

  return (
    <div className={`bg-gray-900 border rounded-xl overflow-hidden ${provider.active ? 'border-gray-700' : 'border-gray-800 opacity-60'}`}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${provider.active ? 'bg-green-400' : 'bg-gray-600'}`} />
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{provider.name}</p>
            <p className="text-xs text-gray-500 font-mono">{provider.slug}</p>
          </div>
          {provider.baseUrl && (
            <span className="hidden md:block text-xs text-gray-600 truncate max-w-xs">{provider.baseUrl}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-500">{provider.games.length} game{provider.games.length !== 1 ? 's' : ''}</span>
          <button
            onClick={handleToggleActive}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              provider.active
                ? 'border-green-700 text-green-400 hover:bg-green-900/20'
                : 'border-gray-700 text-gray-500 hover:bg-gray-800'
            }`}
          >
            {provider.active ? 'Active' : 'Inactive'}
          </button>
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-red-500 hover:text-red-400 disabled:opacity-40 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-800 px-5 py-4 space-y-4">
          {/* Game mappings */}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Game Mappings</p>
            {provider.games.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No games assigned yet</p>
            ) : (
              <div className="space-y-2">
                {provider.games.map(g => (
                  <div key={g.gameSlug} className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${g.active ? 'bg-cyan-400' : 'bg-gray-600'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{GAME_LABELS[g.gameSlug]}</p>
                      {g.providerGameId && (
                        <p className="text-xs text-gray-500 font-mono truncate">ID: {g.providerGameId}</p>
                      )}
                      {g.launchUrlTemplate && (
                        <p className="text-xs text-gray-600 font-mono truncate">URL: {g.launchUrlTemplate}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleToggleGame(g)}
                      className="text-xs text-gray-500 hover:text-white transition-colors"
                    >
                      {g.active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => handleRemoveGame(g.gameSlug)}
                      className="text-red-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add game mapping */}
          {availableSlugs.length > 0 && (
            <div>
              {!addingGame ? (
                <button
                  onClick={() => { setAddingGame(true); setGameForm({ ...defaultGameForm(), gameSlug: availableSlugs[0] }) }}
                  className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  <Plus size={12} /> Assign game
                </button>
              ) : (
                <form onSubmit={handleAddGame} className="space-y-3 bg-gray-800/40 rounded-lg p-3">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Assign Game</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Game</label>
                      <select
                        value={gameForm.gameSlug}
                        onChange={e => setGameForm(f => ({ ...f, gameSlug: e.target.value as GameSlug }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600"
                      >
                        {availableSlugs.map(s => (
                          <option key={s} value={s}>{GAME_LABELS[s]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Provider Game ID</label>
                      <input
                        type="text"
                        value={gameForm.providerGameId}
                        onChange={e => setGameForm(f => ({ ...f, providerGameId: e.target.value }))}
                        placeholder="e.g. aviator_v2"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">
                      Launch URL Template
                      <span className="text-gray-600 ml-1">· Use {'{gameId}'}, {'{playerId}'}, {'{token}'}, {'{currency}'}, {'{lang}'}</span>
                    </label>
                    <input
                      type="text"
                      value={gameForm.launchUrlTemplate}
                      onChange={e => setGameForm(f => ({ ...f, launchUrlTemplate: e.target.value }))}
                      placeholder="https://api.provider.com/launch?game={gameId}&token={token}"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 font-mono"
                    />
                    <p className="text-xs text-gray-600 mt-1">Leave blank to use provider base URL + default params.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingGame(false)}
                      className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add provider form
// ---------------------------------------------------------------------------

function AddProviderForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(defaultProviderForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update(k: string, v: string | boolean) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.slug.trim()) return
    setSaving(true)
    setError(null)
    const { error: err } = await apiFetch('/admin/game-providers', {
      method: 'POST',
      body: JSON.stringify(form),
    })
    if (err) {
      setError(err.message)
      setSaving(false)
      return
    }
    setForm(defaultProviderForm())
    setOpen(false)
    setSaving(false)
    onCreated()
  }

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
      >
        <span className={`text-lg leading-none transition-transform ${open ? 'rotate-45' : ''}`}>+</span>
        {open ? 'Cancel' : 'Add Provider'}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <p className="text-sm font-semibold text-gray-300">New Game Provider</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Display Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => update('name', e.target.value.slice(0, 100))}
                placeholder="Spribe"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Slug <span className="text-gray-600">(lowercase, hyphens only)</span>
              </label>
              <input
                type="text"
                value={form.slug}
                onChange={e => update('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 50))}
                placeholder="spribe"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">Base URL</label>
            <input
              type="url"
              value={form.baseUrl}
              onChange={e => update('baseUrl', e.target.value)}
              placeholder="https://api.provider.com"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 font-mono"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">API Key</label>
              <input
                type="text"
                value={form.apiKey}
                onChange={e => update('apiKey', e.target.value)}
                placeholder="pk_live_…"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">API Secret</label>
              <input
                type="password"
                value={form.apiSecret}
                onChange={e => update('apiSecret', e.target.value)}
                placeholder="sk_live_…"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 font-mono"
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded px-3 py-2">{error}</p>}

          <button
            type="submit"
            disabled={saving || !form.name.trim() || !form.slug.trim()}
            className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm py-2 rounded-lg transition-colors"
          >
            {saving ? 'Creating…' : 'Create Provider'}
          </button>
        </form>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// IntegrationsTab
// ---------------------------------------------------------------------------

export function IntegrationsTab() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchProviders = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await apiFetch<{ providers: Provider[] }>('/admin/game-providers')
    if (data) setProviders(data.providers)
    else setError(err?.message ?? 'Failed to load providers')
    setLoading(false)
  }, [])

  useEffect(() => { fetchProviders() }, [fetchProviders])

  const configured = new Set(providers.flatMap(p => p.games.filter(g => g.active).map(g => g.gameSlug)))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Game Provider Integrations</h2>
          <p className="text-xs text-gray-500 mt-0.5">Configure third-party providers and assign them to game slots.</p>
        </div>
        <button
          onClick={fetchProviders}
          disabled={loading}
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Loading…' : <><RefreshCw size={12} className="inline mr-1" />Refresh</>}
        </button>
      </div>

      {/* Game slot status grid */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Game Slot Status</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {GAME_SLUGS.map(slug => (
            <div
              key={slug}
              className={`rounded-lg px-3 py-2.5 border text-center ${
                configured.has(slug)
                  ? 'border-cyan-700/50 bg-cyan-900/10'
                  : 'border-gray-800 bg-gray-800/30'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full mx-auto mb-1.5 ${configured.has(slug) ? 'bg-cyan-400' : 'bg-gray-600'}`} />
              <p className="text-xs font-semibold leading-tight">{GAME_LABELS[slug]}</p>
              <p className={`text-[10px] mt-0.5 ${configured.has(slug) ? 'text-cyan-500' : 'text-gray-600'}`}>
                {configured.has(slug) ? 'Live' : 'Not configured'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* Provider list */}
      <div className="space-y-3">
        {providers.length === 0 && !loading && (
          <p className="text-sm text-gray-600 text-center py-8">No providers added yet. Add one below.</p>
        )}
        {providers.map(p => (
          <ProviderCard key={p.id} provider={p} onRefresh={fetchProviders} />
        ))}
      </div>

      {/* Add provider */}
      <AddProviderForm onCreated={fetchProviders} />

      {/* Webhook info */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
        <p className="text-xs text-gray-500 uppercase tracking-wider">Webhook Endpoints</p>
        <p className="text-xs text-gray-400">Provide these URLs to your game provider for seamless wallet callbacks:</p>
        <div className="space-y-1 font-mono text-xs text-gray-300 bg-gray-800 rounded-lg px-3 py-3">
          <p><span className="text-gray-500">Balance:</span>  POST /provider/balance</p>
          <p><span className="text-gray-500">Debit:  </span>  POST /provider/debit</p>
          <p><span className="text-gray-500">Credit: </span>  POST /provider/credit</p>
          <p><span className="text-gray-500">Rollback:</span> POST /provider/rollback</p>
        </div>
        <p className="text-xs text-gray-600">
          Auth: HMAC-SHA256 via <span className="font-mono">x-provider-id</span>, <span className="font-mono">x-timestamp</span>, <span className="font-mono">x-signature</span> headers.
          The provider slug is used as the provider ID.
        </p>
      </div>
    </div>
  )
}
