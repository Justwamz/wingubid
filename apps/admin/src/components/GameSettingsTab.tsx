'use client'
import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { SlidersHorizontal } from 'lucide-react'

type GameKey = 'crash' | 'mines' | 'dice'

interface LotteryMargin {
  drawType: string
  prizes: { match3: number; match2: number; match1: number }
  rtpPct: number
  edgePct: number
}
interface ScratchMargin {
  rtpPct: number
  edgePct: number
  winRatePct: number
  symbols: { emoji: string; probPct: number; match3: number; match4: number; match5: number }[]
}
interface SettingsResponse {
  houseEdge: Record<GameKey, number>
  lottery: LotteryMargin[]
  scratch: ScratchMargin
}

const GAMES: { key: GameKey; label: string; note: string }[] = [
  { key: 'crash', label: 'Wingu Crash', note: 'Applied to the crash multiplier curve.' },
  { key: 'mines', label: 'Wingu Mines', note: 'Applied to the mines multiplier per safe tile.' },
  { key: 'dice', label: 'Wingu Dice', note: 'Multiplier = (100 − edge) ÷ win chance.' },
]

function edgeColor(edgePct: number) {
  if (edgePct < 0) return 'text-red-400'      // house is losing money
  if (edgePct < 3) return 'text-yellow-400'   // very thin margin
  return 'text-green-400'
}

export function GameSettingsTab() {
  const [edges, setEdges] = useState<Record<GameKey, string>>({ crash: '', mines: '', dice: '' })
  const [lottery, setLottery] = useState<LotteryMargin[]>([])
  const [scratch, setScratch] = useState<ScratchMargin | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await apiFetch<SettingsResponse>('/admin/game-settings')
    if (data) {
      setEdges({
        crash: String(data.houseEdge.crash),
        mines: String(data.houseEdge.mines),
        dice: String(data.houseEdge.dice),
      })
      setLottery(data.lottery ?? [])
      setScratch(data.scratch ?? null)
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

      {/* Read-only: structural margins (fixed prize tables, not editable here) */}
      <div className="pt-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-300">Lotto &amp; Scratch (read-only)</h3>
        <p className="text-xs text-gray-500 max-w-xl">
          These games have no single house-edge setting — their margin comes from fixed prize tables
          and match odds. Figures below are the effective RTP (return to player) and house edge,
          computed from the live prize tables. Editing isn&apos;t available yet.
        </p>

        {/* Lotto */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden max-w-xl mt-2">
          <div className="px-4 py-2.5 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Wingu Lotto
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-800">
                <th className="text-left px-4 py-2">Draw</th>
                <th className="text-right px-4 py-2">Match 3 / 2 / 1</th>
                <th className="text-right px-4 py-2">RTP</th>
                <th className="text-right px-4 py-2">House edge</th>
              </tr>
            </thead>
            <tbody>
              {lottery.map(l => (
                <tr key={l.drawType} className="border-b border-gray-800/50">
                  <td className="px-4 py-2 capitalize">{l.drawType}</td>
                  <td className="px-4 py-2 text-right font-mono text-gray-300">
                    {l.prizes.match3}× / {l.prizes.match2}× / {l.prizes.match1}×
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-gray-300">{l.rtpPct}%</td>
                  <td className={`px-4 py-2 text-right font-mono font-semibold ${edgeColor(l.edgePct)}`}>{l.edgePct}%</td>
                </tr>
              ))}
              {lottery.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-4 text-center text-gray-600">{loading ? 'Loading…' : 'No data'}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Scratch */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden max-w-xl mt-3">
          <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Wingu Scratch</span>
            {scratch && (
              <span className="text-xs">
                <span className="text-gray-500">RTP </span>
                <span className="font-mono text-gray-300">{scratch.rtpPct}%</span>
                <span className="text-gray-600"> · </span>
                <span className="text-gray-500">edge </span>
                <span className={`font-mono font-semibold ${edgeColor(scratch.edgePct)}`}>{scratch.edgePct}%</span>
                <span className="text-gray-600"> · </span>
                <span className="text-gray-500">win rate </span>
                <span className="font-mono text-gray-300">{scratch.winRatePct}%</span>
              </span>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-800">
                <th className="text-left px-4 py-2">Symbol</th>
                <th className="text-right px-4 py-2">Per-cell odds</th>
                <th className="text-right px-4 py-2">3 / 4 / 5 of</th>
              </tr>
            </thead>
            <tbody>
              {scratch?.symbols.map((s, i) => (
                <tr key={i} className="border-b border-gray-800/50">
                  <td className="px-4 py-2 text-lg">{s.emoji}</td>
                  <td className="px-4 py-2 text-right font-mono text-gray-300">{s.probPct}%</td>
                  <td className="px-4 py-2 text-right font-mono text-gray-300">{s.match3}× / {s.match4}× / {s.match5}×</td>
                </tr>
              ))}
              {!scratch && (
                <tr><td colSpan={3} className="px-4 py-4 text-center text-gray-600">{loading ? 'Loading…' : 'No data'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
