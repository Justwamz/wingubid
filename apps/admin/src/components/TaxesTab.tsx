'use client'
import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { Receipt } from 'lucide-react'

type Country = 'KE' | 'UG' | 'TZ' | 'RW'
type TaxType = 'wager_tax' | 'withdrawal_tax'

interface TaxRule {
  country: Country
  taxType: TaxType
  rate: number
  enabled: boolean
}

interface RowState {
  rate: string
  enabled: boolean
  saving: boolean
  error: string | null
  saved: boolean
}

const COUNTRIES: { key: Country; label: string }[] = [
  { key: 'KE', label: 'Kenya' },
  { key: 'UG', label: 'Uganda' },
  { key: 'TZ', label: 'Tanzania' },
  { key: 'RW', label: 'Rwanda' },
]

const TAX_TYPES: { key: TaxType; label: string }[] = [
  { key: 'wager_tax', label: 'Wager tax (on stakes)' },
  { key: 'withdrawal_tax', label: 'Withdrawal tax' },
]

function rowKey(country: Country, taxType: TaxType) {
  return `${country}:${taxType}`
}

function buildDefaultRows(): Record<string, RowState> {
  const rows: Record<string, RowState> = {}
  for (const c of COUNTRIES) {
    for (const t of TAX_TYPES) {
      rows[rowKey(c.key, t.key)] = { rate: '0', enabled: false, saving: false, error: null, saved: false }
    }
  }
  return rows
}

export function TaxesTab() {
  const [rows, setRows] = useState<Record<string, RowState>>(buildDefaultRows())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const { data, error: err } = await apiFetch<{ rules: TaxRule[] }>('/admin/tax-rules')
    if (err) {
      setLoadError(err.message)
      setLoading(false)
      return
    }
    const next = buildDefaultRows()
    for (const rule of data?.rules ?? []) {
      const key = rowKey(rule.country, rule.taxType)
      if (key in next) {
        next[key] = { rate: String(rule.rate), enabled: rule.enabled, saving: false, error: null, saved: false }
      }
    }
    setRows(next)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function updateRow(key: string, patch: Partial<RowState>) {
    setRows(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  async function saveRow(country: Country, taxType: TaxType) {
    const key = rowKey(country, taxType)
    const row = rows[key]
    if (!row) return
    const rate = Number(row.rate)
    if (Number.isNaN(rate)) {
      updateRow(key, { error: 'Enter a valid number.', saved: false })
      return
    }
    updateRow(key, { saving: true, error: null, saved: false })
    const { error: err } = await apiFetch('/admin/tax-rules', {
      method: 'PUT',
      body: JSON.stringify({ country, taxType, rate, enabled: row.enabled }),
    })
    if (err) {
      updateRow(key, { saving: false, error: err.message, saved: false })
      return
    }
    updateRow(key, { saving: false, error: null, saved: true, rate: String(rate) })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Receipt size={16} className="text-cyan-400" />
        <h2 className="text-lg font-semibold">Taxes</h2>
      </div>
      <p className="text-xs text-gray-500 max-w-xl">
        Per-country tax rates applied to wagers and withdrawals. Rates are percentages. Disabled rows are not applied.
      </p>

      {loadError && (
        <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded px-3 py-2 max-w-xl">{loadError}</p>
      )}

      {loading && !loadError && (
        <p className="text-xs text-gray-500">Loading...</p>
      )}

      {!loading && !loadError && (
        <div className="space-y-4">
          {COUNTRIES.map(c => (
            <div key={c.key} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden max-w-xl">
              <div className="px-4 py-2.5 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                {c.label} ({c.key})
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-800">
                    <th className="text-left px-4 py-2">Tax</th>
                    <th className="text-right px-4 py-2">Rate (%)</th>
                    <th className="text-center px-4 py-2">Enabled</th>
                    <th className="text-right px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {TAX_TYPES.map(t => {
                    const key = rowKey(c.key, t.key)
                    const row = rows[key]
                    if (!row) return null
                    return (
                      <tr key={key} className="border-b border-gray-800/50">
                        <td className="px-4 py-2">{t.label}</td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={row.rate}
                            onChange={e => updateRow(key, { rate: e.target.value, saved: false })}
                            disabled={row.saving}
                            className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono text-right focus:outline-none focus:border-cyan-600 disabled:opacity-50"
                          />
                        </td>
                        <td className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={e => updateRow(key, { enabled: e.target.checked, saved: false })}
                            disabled={row.saving}
                            className="w-4 h-4 accent-cyan-600 disabled:opacity-50"
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => saveRow(c.key, t.key)}
                            disabled={row.saving}
                            className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-xs px-3 py-1.5 rounded-lg transition-colors"
                          >
                            {row.saving ? 'Saving...' : 'Save'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {TAX_TYPES.some(t => rows[rowKey(c.key, t.key)]?.error || rows[rowKey(c.key, t.key)]?.saved) && (
                <div className="px-4 py-2 border-t border-gray-800 space-y-1">
                  {TAX_TYPES.map(t => {
                    const key = rowKey(c.key, t.key)
                    const row = rows[key]
                    if (!row) return null
                    return (
                      <div key={key}>
                        {row.error && <p className="text-xs text-red-400">{t.label}: {row.error}</p>}
                        {row.saved && !row.error && <p className="text-xs text-green-400">{t.label}: Saved.</p>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
