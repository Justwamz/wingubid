'use client'
import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { RefreshCw, X } from 'lucide-react'

interface Message { id: string; playerId: string; username: string; text: string; createdAt: string; deleted: boolean }
interface Ban { playerId: string; username: string | null; until: string | null; reason: string | null; createdBy: string; createdAt: string }
interface Settings { enabled: boolean; autoban: { windowMin: number; strikeThreshold: number } }

export function ChatModerationTab() {
  const [messages, setMessages] = useState<Message[]>([])
  const [bans, setBans] = useState<Ban[]>([])
  const [words, setWords] = useState<string[]>([])
  const [settings, setSettings] = useState<Settings>({ enabled: true, autoban: { windowMin: 10, strikeThreshold: 3 } })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newWord, setNewWord] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [m, b, w, s] = await Promise.all([
      apiFetch<{ messages: Message[] }>('/admin/chat/messages'),
      apiFetch<{ bans: Ban[] }>('/admin/chat/bans'),
      apiFetch<{ words: string[] }>('/admin/chat/banned-words'),
      apiFetch<Settings>('/admin/chat/settings'),
    ])
    if (m.data) setMessages(m.data.messages)
    if (b.data) setBans(b.data.bans)
    if (w.data) setWords(w.data.words)
    if (s.data) setSettings(s.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 20_000)
    return () => clearInterval(id)
  }, [load])

  async function run(p: Promise<{ error?: { message: string } }>) {
    setBusy(true); setError(null)
    const { error: err } = await p
    setBusy(false)
    if (err) { setError(err.message); return }
    load()
  }

  const toggleEnabled = () => run(apiFetch('/admin/chat/settings', { method: 'PUT', body: JSON.stringify({ enabled: !settings.enabled }) }))
  const saveAutoban = () => run(apiFetch('/admin/chat/settings', { method: 'PUT', body: JSON.stringify(settings.autoban) }))
  const del = (id: string) => run(apiFetch(`/admin/chat/messages/${id}/delete`, { method: 'POST' }))
  const ban = (playerId: string, durationHours?: number) => run(apiFetch('/admin/chat/ban', { method: 'POST', body: JSON.stringify({ playerId, durationHours }) }))
  const unban = (playerId: string) => run(apiFetch('/admin/chat/unban', { method: 'POST', body: JSON.stringify({ playerId }) }))
  const resetName = (playerId: string) => run(apiFetch('/admin/chat/reset-username', { method: 'POST', body: JSON.stringify({ playerId }) }))
  const addWord = () => { if (newWord.trim()) { run(apiFetch('/admin/chat/banned-words', { method: 'POST', body: JSON.stringify({ word: newWord.trim() }) })); setNewWord('') } }
  const removeWord = (w: string) => run(apiFetch(`/admin/chat/banned-words/${encodeURIComponent(w)}`, { method: 'DELETE' }))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Chat Moderation <span className="text-xs text-gray-500 font-normal">· Wingu Crash</span></h2>
        <button onClick={load} disabled={loading} className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700 disabled:opacity-50 transition-colors">
          <RefreshCw size={11} className="inline mr-1" /> Refresh
        </button>
      </div>

      {error && <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-2.5 text-sm text-red-400">{error}</div>}

      {/* Settings */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-wrap items-end gap-4">
        <div>
          <p className="text-xs text-gray-400 mb-1">Chat status</p>
          <button
            onClick={toggleEnabled}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${settings.enabled ? 'bg-green-700 hover:bg-green-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`}
          >
            {settings.enabled ? 'Chat ON - click to pause' : 'Chat PAUSED - click to enable'}
          </button>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Auto-ban window (min)</label>
          <input type="number" min="1" value={settings.autoban.windowMin}
            onChange={e => setSettings(s => ({ ...s, autoban: { ...s.autoban, windowMin: Number(e.target.value) } }))}
            className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-600" />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Strikes to auto-ban</label>
          <input type="number" min="1" value={settings.autoban.strikeThreshold}
            onChange={e => setSettings(s => ({ ...s, autoban: { ...s.autoban, strikeThreshold: Number(e.target.value) } }))}
            className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-600" />
        </div>
        <button onClick={saveAutoban} disabled={busy} className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors">Save thresholds</button>
        <p className="text-xs text-gray-500 flex-1 min-w-[12rem]">Auto-ban escalates: 1st → 1h, 2nd → 24h, 3rd → permanent (held for review).</p>
      </div>

      {/* Banned words */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-300">Banned words</p>
        <div className="flex flex-wrap gap-2">
          {words.map(w => (
            <span key={w} className="inline-flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-full px-2.5 py-1 text-xs text-gray-300 font-mono">
              {w}
              <button onClick={() => removeWord(w)} disabled={busy} className="text-gray-500 hover:text-red-400"><X size={12} /></button>
            </span>
          ))}
          {words.length === 0 && <span className="text-xs text-gray-600">No words yet.</span>}
        </div>
        <div className="flex gap-2 max-w-sm">
          <input value={newWord} onChange={e => setNewWord(e.target.value)} placeholder="add a word"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-600" />
          <button onClick={addWord} disabled={busy || !newWord.trim()} className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors">Add</button>
        </div>
      </div>

      {/* Active bans */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase tracking-wide">Active bans ({bans.length})</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b border-gray-800">
              <th className="text-left px-4 py-2">Username</th><th className="text-left px-4 py-2">Until</th>
              <th className="text-left px-4 py-2">Reason</th><th className="text-left px-4 py-2">By</th><th className="text-left px-4 py-2">Action</th>
            </tr></thead>
            <tbody>
              {bans.map(b => (
                <tr key={b.playerId} className="border-b border-gray-800/50">
                  <td className="px-4 py-2 font-mono">{b.username ?? '(no name)'}</td>
                  <td className="px-4 py-2 text-xs text-gray-400">{b.until ? new Date(b.until).toLocaleString() : 'Permanent'}</td>
                  <td className="px-4 py-2 text-xs text-gray-400">{b.reason ?? '-'}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{b.createdBy === 'system' ? 'auto' : 'admin'}</td>
                  <td className="px-4 py-2"><button onClick={() => unban(b.playerId)} disabled={busy} className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold">Unban</button></td>
                </tr>
              ))}
              {bans.length === 0 && <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-600">No active bans</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent messages */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase tracking-wide">Recent messages</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b border-gray-800">
              <th className="text-left px-4 py-2">Time</th><th className="text-left px-4 py-2">User</th>
              <th className="text-left px-4 py-2">Message</th><th className="text-left px-4 py-2">Actions</th>
            </tr></thead>
            <tbody>
              {messages.map(m => (
                <tr key={m.id} className={`border-b border-gray-800/50 ${m.deleted ? 'opacity-40' : ''}`}>
                  <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{new Date(m.createdAt).toLocaleTimeString()}</td>
                  <td className="px-4 py-2 font-mono text-gray-300 whitespace-nowrap">{m.username}</td>
                  <td className="px-4 py-2 text-gray-200">{m.deleted ? <span className="italic text-gray-600">deleted</span> : m.text}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {!m.deleted && (
                      <div className="flex items-center gap-2 text-xs">
                        <button onClick={() => del(m.id)} disabled={busy} className="text-red-400 hover:text-red-300">Delete</button>
                        <span className="text-gray-700">|</span>
                        <button onClick={() => ban(m.playerId, 24)} disabled={busy} className="text-orange-400 hover:text-orange-300">Mute 24h</button>
                        <button onClick={() => ban(m.playerId)} disabled={busy} className="text-orange-400 hover:text-orange-300">Ban ∞</button>
                        <span className="text-gray-700">|</span>
                        <button onClick={() => resetName(m.playerId)} disabled={busy} className="text-gray-400 hover:text-gray-200">Reset name</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {messages.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-600">{loading ? 'Loading…' : 'No messages yet'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
