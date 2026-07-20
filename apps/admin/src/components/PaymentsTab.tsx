'use client'
import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { RefreshCw } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaymentConfig {
  provider: 'mpesa' | 'airtel'
  enabled: boolean
  environment: 'sandbox' | 'production'
  config: Record<string, string>
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Field definitions per provider
// ---------------------------------------------------------------------------

const MPESA_FIELDS = [
  { key: 'consumerKey',       label: 'Consumer Key',              type: 'text',     placeholder: 'From Daraja portal' },
  { key: 'consumerSecret',    label: 'Consumer Secret',           type: 'password', placeholder: 'From Daraja portal' },
  { key: 'depositShortCode',  label: 'Deposit Paybill (C2B)',     type: 'text',     placeholder: 'Paybill customers pay into' },
  { key: 'withdrawShortCode', label: 'Withdrawal Shortcode (B2C)',type: 'text',     placeholder: 'Shortcode payouts are sent from' },
  { key: 'passkey',           label: 'Lipa Na M-Pesa Passkey',    type: 'password', placeholder: 'From Daraja portal' },
]

const AIRTEL_FIELDS = [
  { key: 'clientId',     label: 'Client ID',     type: 'text',     placeholder: 'From Airtel Money portal' },
  { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'From Airtel Money portal' },
  { key: 'country',      label: 'Country Code',  type: 'text',     placeholder: 'KE' },
  { key: 'currency',     label: 'Currency',      type: 'text',     placeholder: 'KES' },
]

const FIELD_MAP = { mpesa: MPESA_FIELDS, airtel: AIRTEL_FIELDS }

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://wingubid-api.onrender.com'

const WEBHOOK_URLS: Record<string, string> = {
  mpesa:  `${API_BASE}/webhooks/mpesa`,
  airtel: `${API_BASE}/webhooks/airtel`,
}

// ---------------------------------------------------------------------------
// Provider card
// ---------------------------------------------------------------------------

function ProviderCard({
  config,
  onSaved,
}: {
  config: PaymentConfig
  onSaved: () => void
}) {
  const fields = FIELD_MAP[config.provider]
  const [enabled, setEnabled]     = useState(config.enabled)
  const [env, setEnv]             = useState(config.environment)
  const [values, setValues]       = useState<Record<string, string>>(
    Object.fromEntries(fields.map(f => [f.key, config.config[f.key] ?? ''])),
  )
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [success, setSuccess]     = useState(false)
  const [copied, setCopied]       = useState(false)

  // Sync if parent refreshes
  useEffect(() => {
    setEnabled(config.enabled)
    setEnv(config.environment)
    setValues(Object.fromEntries(fields.map(f => [f.key, config.config[f.key] ?? ''])))
  }, [config, fields])

  function update(key: string, value: string) {
    setValues(v => ({ ...v, [key]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(false)

    // Only send non-empty values - avoids overwriting stored secrets with masked display values
    const configPayload: Record<string, string> = {}
    for (const [k, v] of Object.entries(values)) {
      if (v && !v.includes('***')) configPayload[k] = v
    }

    const { error: err } = await apiFetch(`/admin/payment-configs/${config.provider}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled, environment: env, config: configPayload }),
    })

    setSaving(false)
    if (err) { setError(err.message); return }
    setSuccess(true)
    setTimeout(() => setSuccess(false), 3000)
    onSaved()
  }

  async function copyWebhook() {
    await navigator.clipboard.writeText(WEBHOOK_URLS[config.provider])
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isConfigured = Object.values(config.config).some(v => v)
  const providerName = config.provider === 'mpesa' ? 'M-Pesa (Safaricom Daraja)' : 'Airtel Money'
  const docsUrl = config.provider === 'mpesa'
    ? 'https://developer.safaricom.co.ke'
    : 'https://developers.airtel.africa'

  return (
    <div className={`bg-gray-900 border rounded-xl overflow-hidden ${config.enabled ? 'border-green-800/50' : 'border-gray-800'}`}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${config.enabled ? 'bg-green-400' : isConfigured ? 'bg-yellow-500' : 'bg-gray-600'}`} />
          <div>
            <p className="font-semibold text-sm text-white">{providerName}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {config.enabled
                ? `Live · ${config.environment}`
                : isConfigured
                ? 'Credentials saved · Disabled'
                : 'Not configured'}
              {config.updatedAt && (
                <span className="ml-2 text-gray-600">
                  · Last saved {new Date(config.updatedAt).toLocaleDateString()}
                </span>
              )}
            </p>
          </div>
        </div>
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-cyan-500 hover:text-cyan-400 transition-colors"
        >
          Developer portal →
        </a>
      </div>

      {/* Form */}
      <form onSubmit={handleSave} className="px-5 py-4 space-y-4">
        {/* Environment + Enable row */}
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Environment</label>
            <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
              {(['sandbox', 'production'] as const).map(e => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEnv(e)}
                  className={`px-4 py-1.5 capitalize transition-colors ${
                    env === e
                      ? e === 'production' ? 'bg-green-700 text-white' : 'bg-cyan-700 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <button
              type="button"
              onClick={() => setEnabled(e => !e)}
              className={`relative w-10 h-5 rounded-full transition-colors ${enabled ? 'bg-green-600' : 'bg-gray-700'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : ''}`} />
            </button>
            <span className="text-sm text-gray-300">{enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
        </div>

        {env === 'production' && enabled && (
          <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2.5">
            <span className="text-amber-400 text-sm mt-0.5">⚠</span>
            <p className="text-xs text-amber-300">
              Production mode with live credentials - real money will be collected from customers.
              Ensure your business short code and passkey are from the <strong>live</strong> Daraja environment.
            </p>
          </div>
        )}

        {/* Credential fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {fields.map(f => (
            <div key={f.key}>
              <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
              <input
                type={f.type}
                value={values[f.key]}
                onChange={e => update(f.key, e.target.value)}
                placeholder={values[f.key]?.includes('***') ? 'Already saved - enter new value to update' : f.placeholder}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-600 font-mono"
              />
            </div>
          ))}
        </div>

        {/* Webhook URL */}
        <div>
          <label className="text-xs text-gray-400 block mb-1">
            Callback / Webhook URL <span className="text-gray-600">(provide this to {providerName})</span>
          </label>
          <div className="flex gap-2">
            <code className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono truncate">
              {WEBHOOK_URLS[config.provider]}
            </code>
            <button
              type="button"
              onClick={copyWebhook}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors flex-shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded px-3 py-2">{error}</p>}
        {success && <p className="text-xs text-green-400 bg-green-900/20 border border-green-700/30 rounded px-3 py-2">Configuration saved.</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm py-2 rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Save Configuration'}
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PaymentsTab
// ---------------------------------------------------------------------------

export function PaymentsTab() {
  const [configs, setConfigs] = useState<PaymentConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const fetchConfigs = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await apiFetch<{ configs: PaymentConfig[] }>('/admin/payment-configs')
    if (data) setConfigs(data.configs)
    else setError(err?.message ?? 'Failed to load payment configs')
    setLoading(false)
  }, [])

  useEffect(() => { fetchConfigs() }, [fetchConfigs])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Payment Gateways</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Configure real payment credentials. Simulated demo top-up on the customer side remains active for internal testing.
          </p>
        </div>
        <button
          onClick={fetchConfigs}
          disabled={loading}
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Demo mode notice */}
      <div className="flex items-start gap-3 bg-blue-900/20 border border-blue-700/30 rounded-xl px-4 py-3">
        <span className="text-blue-400 text-base mt-0.5">ℹ</span>
        <div>
          <p className="text-sm font-medium text-blue-300">Demo payments are active</p>
          <p className="text-xs text-blue-400/70 mt-0.5">
            The customer-facing &quot;Add Funds&quot; demo top-up bypasses these gateways entirely.
            Real gateway calls will only happen once a provider is enabled here and the customer uses
            the real deposit flow (M-Pesa or Airtel buttons).
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {loading && configs.length === 0 ? (
        <div className="text-center text-gray-600 text-sm py-12">Loading…</div>
      ) : (
        <div className="space-y-4">
          {configs.map(c => (
            <ProviderCard key={c.provider} config={c} onSaved={fetchConfigs} />
          ))}
        </div>
      )}
    </div>
  )
}
