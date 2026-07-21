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
type AnyGame = 'crash' | 'mines' | 'dice' | 'scratch' | 'lottery'
type MonitoredGame = 'crash' | 'mines' | 'dice' | 'scratch'
interface RtpStat { rtp: number | null; nBets: number; staked: number; paid: number }
interface RtpMonitor {
  windowMinutes: number; minBets: number; reAlertMinutes: number
  warnRtp: Record<MonitoredGame, number>
}
interface SettingsResponse {
  houseEdge: Record<GameKey, number>
  lottery: LotteryMargin[]
  scratch: ScratchMargin
  gamesEnabled: Record<AnyGame, boolean>
  rtpMonitor: RtpMonitor
  realizedRtp: Record<MonitoredGame, RtpStat>
}

const ALL_GAMES: { key: AnyGame; label: string }[] = [
  { key: 'crash', label: 'Wingu Crash' }, { key: 'mines', label: 'Wingu Mines' },
  { key: 'dice', label: 'Wingu Dice' }, { key: 'scratch', label: 'Wingu Scratch' },
  { key: 'lottery', label: 'Wingu Lotto' },
]
const MONITORED: MonitoredGame[] = ['crash', 'mines', 'dice', 'scratch']

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
  const [enabled, setEnabled] = useState<Record<AnyGame, boolean> | null>(null)
  const [rtp, setRtp] = useState<RtpMonitor | null>(null)
  const [realized, setRealized] = useState<Record<MonitoredGame, RtpStat> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
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
      setEnabled(data.gamesEnabled)
      setRtp(data.rtpMonitor)
      setRealized(data.realizedRtp)
    }
    setLoading(false)
  }, [])

  async function toggleGame(game: AnyGame, next: boolean) {
    setBusy(true); setError(null)
    const { error: err } = await apiFetch('/admin/game-settings/game-enabled', {
      method: 'PUT', body: JSON.stringify({ game, enabled: next }),
    })
    setBusy(false)
    if (err) { setError(err.message); return }
    load()
  }

  async function saveRtpConfig() {
    if (!rtp) return
    setBusy(true); setError(null)
    const { error: err } = await apiFetch('/admin/game-settings/rtp-monitor', {
      method: 'PUT', body: JSON.stringify(rtp),
    })
    setBusy(false)
    if (err) { setError(err.message); return }
    setSaved(true); load()
  }

  // Colour a live RTP reading: red if over the warn threshold, grey if the
  // sample is too small to judge, green otherwise.
  function rtpCell(g: MonitoredGame) {
    if (!realized || !rtp) return <span className="text-gray-600">-</span>
    const s = realized[g]
    if (s.rtp == null || s.nBets < rtp.minBets) {
      return <span className="text-gray-500">n/a <span className="text-gray-600">({s.nBets} bets)</span></span>
    }
    const over = s.rtp > rtp.warnRtp[g]
    return <span className={`font-mono font-semibold ${over ? 'text-red-400' : 'text-green-400'}`}>{(s.rtp * 100).toFixed(1)}% <span className="text-gray-600 font-normal">({s.nBets})</span></span>
  }

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
      {/* Availability & RTP monitor */}
      <div className="flex items-center gap-2">
        <SlidersHorizontal size={16} className="text-cyan-400" />
        <h2 className="text-lg font-semibold">Availability &amp; RTP Monitor</h2>
      </div>
      <p className="text-xs text-gray-500 max-w-xl">
        Live realized RTP (payouts ÷ stakes) over the last {rtp?.windowMinutes ?? 60} minutes.
        The risk team is emailed automatically when a game runs above its warn threshold (with enough sample).
        Pause a game to stop new bets immediately; in-progress rounds finish.
      </p>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden max-w-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-800">
              <th className="text-left px-4 py-2">Game</th>
              <th className="text-right px-4 py-2">Live RTP</th>
              <th className="text-right px-4 py-2">Warn &gt;</th>
              <th className="text-right px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {ALL_GAMES.map(g => {
              const monitored = (MONITORED as string[]).includes(g.key)
              const on = enabled?.[g.key] ?? true
              return (
                <tr key={g.key} className="border-b border-gray-800/50">
                  <td className="px-4 py-2">{g.label}</td>
                  <td className="px-4 py-2 text-right">{monitored ? rtpCell(g.key as MonitoredGame) : <span className="text-gray-600">-</span>}</td>
                  <td className="px-4 py-2 text-right font-mono text-gray-400">{monitored && rtp ? `${(rtp.warnRtp[g.key as MonitoredGame] * 100).toFixed(0)}%` : '-'}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => toggleGame(g.key, !on)}
                      disabled={busy || loading}
                      className={`text-xs font-semibold rounded px-2.5 py-1 transition-colors disabled:opacity-50 ${on ? 'bg-green-700 hover:bg-green-600 text-white' : 'bg-red-800 hover:bg-red-700 text-white'}`}
                    >
                      {on ? 'Live - pause' : 'Paused - resume'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {rtp && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-wrap items-end gap-4 max-w-xl">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Window (min)</label>
            <input type="number" min="5" value={rtp.windowMinutes}
              onChange={e => setRtp(r => r && ({ ...r, windowMinutes: Number(e.target.value) }))}
              className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-600" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Min bets</label>
            <input type="number" min="1" value={rtp.minBets}
              onChange={e => setRtp(r => r && ({ ...r, minBets: Number(e.target.value) }))}
              className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-600" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Re-alert (min)</label>
            <input type="number" min="5" value={rtp.reAlertMinutes}
              onChange={e => setRtp(r => r && ({ ...r, reAlertMinutes: Number(e.target.value) }))}
              className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-600" />
          </div>
          {MONITORED.map(g => (
            <div key={g}>
              <label className="text-xs text-gray-400 block mb-1 capitalize">{g} warn %</label>
              <input type="number" step="1" min="1" value={Math.round(rtp.warnRtp[g] * 100)}
                onChange={e => setRtp(r => r && ({ ...r, warnRtp: { ...r.warnRtp, [g]: Number(e.target.value) / 100 } }))}
                className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-600" />
            </div>
          ))}
          <button onClick={saveRtpConfig} disabled={busy} className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors">Save monitor</button>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <SlidersHorizontal size={16} className="text-cyan-400" />
        <h2 className="text-lg font-semibold">Game Margins (House Edge)</h2>
      </div>
      <p className="text-xs text-gray-500 max-w-md">
        The house edge is the percentage the house keeps on every bet. A higher edge means
        smaller payouts and more margin. Changes take effect immediately for new bets. Allowed range: 0-30%.
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
          These games have no single house-edge setting - their margin comes from fixed prize tables
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
