'use client'
import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { RefreshCw, Plus, Trash2, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderSummary {
  id: string
  name: string
  slug: string
}

interface SlotAssignment {
  providerGameId: string
  launchUrlTemplate: string
  active: boolean
  provider: ProviderSummary
}

interface GameSlot {
  id: string
  name: string
  slug: string
  createdAt: string
  assignment: SlotAssignment | null
}

// ---------------------------------------------------------------------------
// Add Slot form
// ---------------------------------------------------------------------------

function AddSlotForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleNameChange(v: string) {
    setName(v)
    // Auto-generate slug from name
    setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error: err } = await apiFetch('/admin/game-slots', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), slug }),
    })
    if (err) { setError(err.message); setSaving(false); return }
    setName(''); setSlug(''); setOpen(false); setSaving(false)
    onCreated()
  }

  return (
    <div>
      <button
        onClick={() => { setOpen(o => !o); setError(null) }}
        className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
      >
        <Plus size={14} />
        {open ? 'Cancel' : 'Add Game Slot'}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="mt-3 bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3 max-w-md">
          <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">New Game Slot</p>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Game Name</label>
            <input
              type="text"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="e.g. Plinko"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              Slug <span className="text-gray-600">(auto-generated, editable)</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="plinko"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 font-mono"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={saving || !name.trim() || !slug.trim()}
            className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm py-2 rounded-lg transition-colors"
          >
            {saving ? 'Creating…' : 'Create Slot'}
          </button>
        </form>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Configure slot panel — shown inline when a slot is clicked
// ---------------------------------------------------------------------------

function ConfigureSlotPanel({
  slot,
  providers,
  onDone,
  onRemove,
}: {
  slot: GameSlot
  providers: ProviderSummary[]
  onDone: () => void
  onRemove: () => void
}) {
  const isEditing = slot.assignment !== null
  const [providerMode, setProviderMode] = useState<'existing' | 'new'>(
    isEditing || providers.length > 0 ? 'existing' : 'new',
  )
  const [selectedProviderId, setSelectedProviderId] = useState(
    slot.assignment?.provider.id ?? providers[0]?.id ?? '',
  )

  // New provider fields
  const [provName, setProvName] = useState('')
  const [provSlug, setProvSlug] = useState('')
  const [provBaseUrl, setProvBaseUrl] = useState('')
  const [provApiKey, setProvApiKey] = useState('')
  const [provApiSecret, setProvApiSecret] = useState('')

  // Game-specific fields
  const [gameId, setGameId] = useState(slot.assignment?.providerGameId ?? '')
  const [launchUrl, setLaunchUrl] = useState(slot.assignment?.launchUrlTemplate ?? '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  function handleProvNameChange(v: string) {
    setProvName(v)
    setProvSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    let providerId = selectedProviderId

    // Create provider first if new
    if (providerMode === 'new') {
      const { data, error: err } = await apiFetch<{ id: string }>('/admin/game-providers', {
        method: 'POST',
        body: JSON.stringify({
          name: provName.trim(),
          slug: provSlug.trim(),
          baseUrl: provBaseUrl.trim(),
          apiKey: provApiKey,
          apiSecret: provApiSecret,
          active: true,
        }),
      })
      if (err || !data?.id) { setError(err?.message ?? 'Failed to create provider'); setSaving(false); return }
      providerId = data.id
    }

    // Assign game slot to provider
    const { error: err2 } = await apiFetch(`/admin/game-providers/${providerId}/games`, {
      method: 'POST',
      body: JSON.stringify({
        gameSlug: slot.slug,
        providerGameId: gameId,
        launchUrlTemplate: launchUrl,
        active: true,
      }),
    })
    if (err2) { setError(err2.message); setSaving(false); return }

    setSaving(false)
    onDone()
  }

  async function handleRemove() {
    if (!slot.assignment) return
    if (!confirm(`Remove the provider assignment from "${slot.name}"?`)) return
    setRemoving(true)
    await apiFetch(
      `/admin/game-providers/${slot.assignment.provider.id}/games/${slot.slug}`,
      { method: 'DELETE' },
    )
    setRemoving(false)
    onRemove()
  }

  return (
    <form onSubmit={handleSave} className="mt-2 bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          {isEditing ? `Edit: ${slot.name}` : `Configure: ${slot.name}`}
        </p>
        {isEditing && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={removing}
            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 flex items-center gap-1 transition-colors"
          >
            <Trash2 size={11} /> {removing ? 'Removing…' : 'Remove assignment'}
          </button>
        )}
      </div>

      {/* Provider selection */}
      <div>
        <label className="text-xs text-gray-400 block mb-2">Provider</label>

        {providers.length > 0 && (
          <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs mb-3 w-fit">
            <button
              type="button"
              onClick={() => setProviderMode('existing')}
              className={`px-3 py-1.5 transition-colors ${providerMode === 'existing' ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              Existing provider
            </button>
            <button
              type="button"
              onClick={() => setProviderMode('new')}
              className={`px-3 py-1.5 transition-colors ${providerMode === 'new' ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              New provider
            </button>
          </div>
        )}

        {providerMode === 'existing' && providers.length > 0 ? (
          <select
            value={selectedProviderId}
            onChange={e => setSelectedProviderId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600"
          >
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.slug})</option>
            ))}
          </select>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Provider Name</label>
                <input
                  type="text"
                  value={provName}
                  onChange={e => handleProvNameChange(e.target.value)}
                  placeholder="Spribe"
                  required={providerMode === 'new'}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Provider Slug</label>
                <input
                  type="text"
                  value={provSlug}
                  onChange={e => setProvSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="spribe"
                  required={providerMode === 'new'}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 font-mono"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Base URL</label>
              <input
                type="url"
                value={provBaseUrl}
                onChange={e => setProvBaseUrl(e.target.value)}
                placeholder="https://api.provider.com"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 font-mono"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">API Key</label>
                <input
                  type="text"
                  value={provApiKey}
                  onChange={e => setProvApiKey(e.target.value)}
                  placeholder="pk_live_…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">API Secret</label>
                <input
                  type="password"
                  value={provApiSecret}
                  onChange={e => setProvApiSecret(e.target.value)}
                  placeholder="sk_live_…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 font-mono"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Game-specific fields */}
      <div className="border-t border-gray-800 pt-4 space-y-3">
        <p className="text-xs text-gray-500 uppercase tracking-wider">Game Configuration</p>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Provider Game ID <span className="text-gray-600">(optional)</span></label>
          <input
            type="text"
            value={gameId}
            onChange={e => setGameId(e.target.value)}
            placeholder="e.g. aviator_v2"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 font-mono"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">
            Launch URL Template <span className="text-gray-600">· {'{gameId}'} {'{playerId}'} {'{token}'} {'{currency}'} {'{lang}'}</span>
          </label>
          <input
            type="text"
            value={launchUrl}
            onChange={e => setLaunchUrl(e.target.value)}
            placeholder="https://api.provider.com/launch?game={gameId}&token={token}&player={playerId}"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 font-mono text-xs"
          />
          <p className="text-xs text-gray-600 mt-1">Leave blank to use provider base URL with default params.</p>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded px-3 py-2">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm py-2 rounded-lg transition-colors"
      >
        {saving ? 'Saving…' : isEditing ? 'Update Configuration' : 'Save Configuration'}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Slot card
// ---------------------------------------------------------------------------

function SlotCard({
  slot,
  providers,
  onRefresh,
  onDelete,
}: {
  slot: GameSlot
  providers: ProviderSummary[]
  onRefresh: () => void
  onDelete: (slug: string) => void
}) {
  const [open, setOpen] = useState(false)
  const isLive = slot.assignment?.active ?? false
  const isAssigned = slot.assignment !== null

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${isLive ? 'border-cyan-800/60 bg-cyan-950/10' : 'border-gray-800 bg-gray-900/40'}`}>
      {/* Slot header — always clickable */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        {/* Status dot */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isLive ? 'bg-cyan-400' : isAssigned ? 'bg-yellow-500' : 'bg-gray-600'}`} />

        {/* Slot info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{slot.name}</p>
          <p className="text-xs text-gray-500 font-mono">{slot.slug}</p>
        </div>

        {/* Status badge */}
        {isLive ? (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-900/40 text-cyan-400 border border-cyan-700/40 flex-shrink-0">
            Live · {slot.assignment!.provider.name}
          </span>
        ) : isAssigned ? (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-900/30 text-yellow-500 border border-yellow-700/30 flex-shrink-0">
            Inactive · {slot.assignment!.provider.name}
          </span>
        ) : (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 border border-gray-700 flex-shrink-0">
            Not configured
          </span>
        )}

        {/* Chevron */}
        <span className="text-gray-600 flex-shrink-0">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {/* Expanded panel */}
      {open && (
        <div className="px-4 pb-4 border-t border-gray-800">
          <ConfigureSlotPanel
            slot={slot}
            providers={providers}
            onDone={() => { setOpen(false); onRefresh() }}
            onRemove={() => { setOpen(false); onRefresh() }}
          />
          {/* Delete slot option — only when unassigned */}
          {!isAssigned && (
            <button
              onClick={() => onDelete(slot.slug)}
              className="mt-3 text-xs text-gray-600 hover:text-red-400 flex items-center gap-1 transition-colors"
            >
              <Trash2 size={11} /> Delete this slot
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SMS / OTP provider config
// ---------------------------------------------------------------------------

function SmsProviderCard() {
  const [enabled, setEnabled] = useState(false)
  const [username, setUsername] = useState('')
  const [senderId, setSenderId] = useState('')
  const [apiKey, setApiKey] = useState('')       // only sent if the admin types a new one
  const [maskedKey, setMaskedKey] = useState('')  // masked existing key, display only
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await apiFetch<{ config: { enabled: boolean; config: Record<string, string> } }>('/admin/sms-config')
    if (data) {
      setEnabled(data.config.enabled)
      setUsername(data.config.config.username ?? '')
      setSenderId(data.config.config.senderId ?? '')
      setMaskedKey(data.config.config.apiKey ?? '')
      setApiKey('')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null); setSaved(false)
    const config: Record<string, string> = { username: username.trim(), senderId: senderId.trim() }
    if (apiKey.trim()) config.apiKey = apiKey.trim()  // omit when unchanged so we don't clobber the stored key
    const { error: err } = await apiFetch('/admin/sms-config', {
      method: 'PUT',
      body: JSON.stringify({ enabled, config }),
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setSaved(true)
    load()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare size={16} className="text-cyan-400" />
        <h2 className="text-lg font-semibold">SMS / OTP Provider</h2>
        {enabled ? (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-900/40 text-cyan-400 border border-cyan-700/40">Live</span>
        ) : (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 border border-gray-700">Disabled</span>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Wire the SMS gateway that sends registration OTPs. While disabled, OTPs are simulated and phones auto-verify.
        Turning this on makes registration send a real OTP and require verification before login.
      </p>

      <form onSubmit={handleSave} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3 max-w-md">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Provider</label>
          <input value="Africa's Talking" disabled className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-400" />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Username</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="e.g. winguBet"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={maskedKey ? `Saved: ${maskedKey} — type to replace` : 'atsk_…'}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 font-mono"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Sender ID <span className="text-gray-600">(optional)</span></label>
          <input
            type="text"
            value={senderId}
            onChange={e => setSenderId(e.target.value)}
            placeholder="e.g. WINGUBET"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600"
          />
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer text-sm text-gray-300 pt-1">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="h-4 w-4 accent-cyan-400" />
          <span>Enabled — send live OTPs and require phone verification</span>
        </label>

        {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded px-3 py-2">{error}</p>}
        {saved && !error && <p className="text-xs text-green-400">Saved.</p>}

        <button
          type="submit"
          disabled={saving || loading}
          className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm py-2 rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Save SMS Configuration'}
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// IntegrationsTab
// ---------------------------------------------------------------------------

export function IntegrationsTab() {
  const [slots, setSlots] = useState<GameSlot[]>([])
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWebhooks, setShowWebhooks] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [slotsRes, providersRes] = await Promise.all([
      apiFetch<{ slots: GameSlot[] }>('/admin/game-slots'),
      apiFetch<{ providers: ProviderSummary[] }>('/admin/game-providers'),
    ])
    if (slotsRes.data) setSlots(slotsRes.data.slots)
    else setError(slotsRes.error?.message ?? 'Failed to load game slots')
    if (providersRes.data) setProviders(providersRes.data.providers)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function handleDelete(slug: string) {
    if (!confirm(`Delete game slot "${slug}"? This cannot be undone.`)) return
    const { error: err } = await apiFetch(`/admin/game-slots/${slug}`, { method: 'DELETE' })
    if (err) { alert(err.message); return }
    fetchAll()
  }

  const liveCount = slots.filter(s => s.assignment?.active).length

  return (
    <div className="space-y-6">
      {/* SMS / OTP provider */}
      <SmsProviderCard />

      <div className="border-t border-gray-800" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Game Integrations</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {liveCount} of {slots.length} game slot{slots.length !== 1 ? 's' : ''} live.
            Click any slot to configure its provider.
          </p>
        </div>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* Slot list */}
      {loading && slots.length === 0 ? (
        <div className="text-center text-gray-600 text-sm py-12">Loading…</div>
      ) : (
        <div className="space-y-2">
          {slots.map(slot => (
            <SlotCard
              key={slot.slug}
              slot={slot}
              providers={providers}
              onRefresh={fetchAll}
              onDelete={handleDelete}
            />
          ))}
          {slots.length === 0 && (
            <p className="text-sm text-gray-600 text-center py-8">No game slots yet. Add one below.</p>
          )}
        </div>
      )}

      {/* Add slot */}
      <AddSlotForm onCreated={fetchAll} />

      {/* Webhook reference — collapsed by default */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowWebhooks(w => !w)}
          className="w-full px-4 py-3 flex items-center justify-between text-xs text-gray-500 hover:text-gray-400 transition-colors"
        >
          <span className="uppercase tracking-wider font-semibold">Webhook Endpoints</span>
          {showWebhooks ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {showWebhooks && (
          <div className="px-4 pb-4 border-t border-gray-800 space-y-2 pt-3">
            <p className="text-xs text-gray-400">Provide these URLs to your game provider for wallet callbacks:</p>
            <div className="space-y-1 font-mono text-xs text-gray-300 bg-gray-800 rounded-lg px-3 py-3">
              <p><span className="text-gray-500">Balance: </span> POST /provider/balance</p>
              <p><span className="text-gray-500">Debit:   </span> POST /provider/debit</p>
              <p><span className="text-gray-500">Credit:  </span> POST /provider/credit</p>
              <p><span className="text-gray-500">Rollback:</span> POST /provider/rollback</p>
            </div>
            <p className="text-xs text-gray-600">
              Auth: HMAC-SHA256 via <span className="font-mono">x-provider-id</span>, <span className="font-mono">x-timestamp</span>, <span className="font-mono">x-signature</span> headers.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
