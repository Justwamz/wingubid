'use client'
import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { SlidersHorizontal } from 'lucide-react'

type GameKey = 'crash' | 'mines' | 'dice'

const GAMES: { key: GameKey; label: string; note: string }[] = [
  { key: 'crash', label: 'Wingu Crash', note: 'Applied to the crash multiplier curve.' },
  { key: 'mines', label: 'Wingu Mines', note: 'Applied to the mines multiplier per safe tile.' },
  { key: 'dice', label: 'Wingu Dice', note: 'Multiplier = (100 − edge) ÷ win chance.' },
]

export function GameSettingsTab() {
  const [edges, setEdges] = useState<Record<GameKey, string>>({ crash: '', mines: '', dice: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await apiFetch<{ houseEdge: Record<GameKey, number> }>('/admin/game-settings')
    if (data) {
      setEdges({
        crash: String(data.houseEdge.crash),
        mines: String(data.houseEdge.mines),
        dice: String(data.houseEdge.dice),
      })
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null); setSaved(false)
    const body = {
      crash: Number(edges.crash),
      mines: Number(edges.mines),
      dice: Number(edges.dice),
    }
    if ([body.crash, body.mines, body.dice].some(n => Number.isNaN(n))) {
      setSaving(false); setError('Enter a valid number for each game.'); return
    }
    const { error: err } = await apiFetch('/admin/game-settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setSaved(true)
    load()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SlidersHorizontal size={16} className="text-cyan-400" />
        <h2 className="text-lg font-semibold">Game Margins (House Edge)</h2>
      </div>
      <p className="text-xs text-gray-500 max-w-md">
        The house edge is the percentage the house keeps on every bet. A higher edge means
        smaller payouts and more margin. Changes take effect immediately for new bets. Allowed range: 0–30%.
      </p>

      <form onSubmit={handleSave} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4 max-w-md">
        {GAMES.map(g => (
          <div key={g.key}>
            <label className="text-sm text-gray-300 block mb-1">{g.label}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.5"
                min="0"
                max="30"
                value={edges[g.key]}
                onChange={e => setEdges(prev => ({ ...prev, [g.key]: e.target.value }))}
                disabled={loading}
                className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600 font-mono"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
            <p className="text-xs text-gray-600 mt-1">{g.note}</p>
          </div>
        ))}

        {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded px-3 py-2">{error}</p>}
        {saved && !error && <p className="text-xs text-green-400">Saved.</p>}

        <button
          type="submit"
          disabled={saving || loading}
          className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm py-2 rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Save Margins'}
        </button>
      </form>
    </div>
  )
}
