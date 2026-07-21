'use client'
import { useEffect, useRef, useState } from 'react'
import { useGameChat } from '@/hooks/useGameChat'
import { Send } from 'lucide-react'

export function ChatPanel() {
  const { messages, enabled, username, banned, error, send, saveUsername, clearError } = useGameChat()
  const [text, setText] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to newest.
  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Auto-dismiss transient errors.
  useEffect(() => {
    if (!error) return
    const t = setTimeout(clearError, 3000)
    return () => clearTimeout(t)
  }, [error, clearError])

  async function handleSetName(e: React.FormEvent) {
    e.preventDefault()
    setNameError(null); setSavingName(true)
    try {
      await saveUsername(nameInput.trim())
      setNameInput('')
    } catch (err: unknown) {
      setNameError(err instanceof Error ? err.message : 'Could not set that name.')
    } finally {
      setSavingName(false)
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    send(t)
    setText('')
  }

  return (
    <div className="bg-game-card border border-game-border rounded-2xl flex flex-col h-96">
      <div className="px-4 py-2.5 border-b border-game-border flex items-center justify-between">
        <p className="text-xs font-mono font-bold uppercase tracking-widest text-gray-400">Live Chat</p>
        {!enabled && <span className="text-[10px] text-yellow-400 font-semibold">PAUSED</span>}
      </div>

      {/* Feed */}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-6">No messages yet. Say hi!</p>
        ) : (
          messages.map(m => (
            <div key={m.id} className="text-sm leading-snug">
              <span className="font-bold text-accent-cyan">{m.username}</span>
              <span className="text-gray-600">: </span>
              <span className="text-gray-200 break-words">{m.text}</span>
            </div>
          ))
        )}
      </div>

      {error && (
        <p className="px-4 py-1.5 text-xs text-warning-coral">{error.message}</p>
      )}

      {/* Composer */}
      <div className="border-t border-game-border p-3">
        {banned ? (
          <p className="text-xs text-warning-coral text-center py-1.5">{banned}</p>
        ) : !enabled ? (
          <p className="text-xs text-gray-500 text-center py-1.5">Chat is paused by moderators.</p>
        ) : username === null ? (
          <form onSubmit={handleSetName} className="space-y-2">
            <p className="text-xs text-gray-400">Pick a chat name to join in:</p>
            <div className="flex gap-2">
              <input
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                placeholder="e.g. SwiftFalcon12"
                maxLength={20}
                className="flex-1 bg-game-bg border border-game-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-cyan"
              />
              <button
                type="submit"
                disabled={savingName || nameInput.trim().length < 3}
                className="px-3 py-2 rounded-lg bg-accent-cyan text-black font-bold text-xs disabled:opacity-40"
              >
                {savingName ? '…' : 'Set'}
              </button>
            </div>
            {nameError && <p className="text-xs text-warning-coral">{nameError}</p>}
          </form>
        ) : (
          <form onSubmit={handleSend} className="flex gap-2 items-center">
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={`Chat as ${username}…`}
              maxLength={200}
              className="flex-1 bg-game-bg border border-game-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-cyan"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              aria-label="Send message"
              className="p-2 rounded-lg bg-accent-cyan text-black disabled:opacity-40"
            >
              <Send size={16} />
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
