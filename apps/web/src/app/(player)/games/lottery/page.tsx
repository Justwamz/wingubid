'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/apiFetch'
import { refreshBalance } from '@/lib/auth'

// ─── Types ────────────────────────────────────────────────────────────────────

type DrawType = 'hourly' | 'daily' | 'weekly'

interface Draw {
  id: string
  drawType: DrawType
  ticketPrice: number
  scheduledAt: string
  jackpot: number
}

interface DrawsResponse {
  draws: Draw[]
}

interface BuyTicketResponse {
  ticketId: string
  drawId: string
  scheduledAt: string
  ticketPrice: number
}

interface Ticket {
  id: string
  drawType: DrawType
  pickedNumbers: number[]
  ticketPrice: number
  matchedCount: number | null
  prizeCents: number | null
  status: 'pending' | 'settled'
  scheduledAt: string
  winningNumbers: number[] | null
  createdAt: string
}

interface TicketsResponse {
  tickets: Ticket[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DRAW_COLORS: Record<DrawType, { accent: string; border: string; bg: string; badge: string; badgeBg: string; ring: string }> = {
  hourly: {
    accent: 'text-cyan-400',
    border: 'border-cyan-500/30',
    bg: 'bg-cyan-500/5',
    badge: 'text-cyan-400',
    badgeBg: 'bg-cyan-500/10 border-cyan-500/20',
    ring: 'ring-cyan-500/60',
  },
  daily: {
    accent: 'text-violet-400',
    border: 'border-violet-500/30',
    bg: 'bg-violet-500/5',
    badge: 'text-violet-400',
    badgeBg: 'bg-violet-500/10 border-violet-500/20',
    ring: 'ring-violet-500/60',
  },
  weekly: {
    accent: 'text-amber-400',
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/5',
    badge: 'text-amber-400',
    badgeBg: 'bg-amber-500/10 border-amber-500/20',
    ring: 'ring-amber-500/60',
  },
}

const DRAW_LABEL: Record<DrawType, string> = {
  hourly: 'HOURLY',
  daily: 'DAILY',
  weekly: 'WEEKLY',
}

function formatCents(cents: number): string {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 0 })}`
}

function computeCountdown(scheduledAt: string): string {
  const diff = Math.max(0, new Date(scheduledAt).getTime() - Date.now())
  const totalSec = Math.floor(diff / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ─── Countdown component ──────────────────────────────────────────────────────

function Countdown({ scheduledAt }: { scheduledAt: string }) {
  const [display, setDisplay] = useState(() => computeCountdown(scheduledAt))

  useEffect(() => {
    const id = setInterval(() => setDisplay(computeCountdown(scheduledAt)), 1000)
    return () => clearInterval(id)
  }, [scheduledAt])

  return <span className="font-mono tabular-nums">{display}</span>
}

// ─── Tier Card ────────────────────────────────────────────────────────────────

interface TierCardProps {
  draw: Draw
  selected: boolean
  onSelect: () => void
}

function TierCard({ draw, selected, onSelect }: TierCardProps) {
  const c = DRAW_COLORS[draw.drawType]
  return (
    <button
      onClick={onSelect}
      className={`flex-1 min-w-0 rounded-2xl border p-4 text-left transition-all focus:outline-none ${
        selected
          ? `${c.border} ${c.bg} ring-2 ${c.ring}`
          : 'border-game-border bg-game-card hover:border-gray-600'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className={`text-xs font-mono font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${c.badgeBg} ${c.badge}`}>
          {DRAW_LABEL[draw.drawType]}
        </span>
        {selected && (
          <span className={`text-xs font-bold ${c.accent}`}>Selected</span>
        )}
      </div>

      {/* Jackpot */}
      <p className={`text-2xl font-extrabold font-mono ${c.accent} leading-tight`}>
        {formatCents(draw.jackpot)}
      </p>
      <p className="text-xs text-gray-500 mb-3">jackpot (3-match)</p>

      {/* Ticket price */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-400">Ticket price</span>
        <span className="text-white font-bold font-mono">{formatCents(draw.ticketPrice)}</span>
      </div>

      {/* Countdown */}
      <div className="flex items-center justify-between text-sm mt-1.5">
        <span className="text-gray-400">Draw in</span>
        <span className={`text-sm font-semibold ${c.accent}`}>
          <Countdown scheduledAt={draw.scheduledAt} />
        </span>
      </div>
    </button>
  )
}

// ─── Number Picker ────────────────────────────────────────────────────────────

interface NumberPickerProps {
  selected: number[]
  onToggle: (n: number) => void
}

function NumberPicker({ selected, onToggle }: NumberPickerProps) {
  return (
    <div className="grid grid-cols-6 gap-2">
      {Array.from({ length: 36 }, (_, i) => i + 1).map(n => {
        const isSelected = selected.includes(n)
        const atMax = selected.length >= 3
        return (
          <button
            key={n}
            onClick={() => onToggle(n)}
            disabled={!isSelected && atMax}
            className={`aspect-square rounded-xl font-mono font-bold text-sm transition-all focus:outline-none ${
              isSelected
                ? 'bg-cyan-500 text-gray-950 shadow-lg shadow-cyan-500/30 scale-105'
                : atMax
                ? 'bg-game-bg border border-game-border text-gray-600 cursor-not-allowed opacity-40'
                : 'bg-game-bg border border-game-border text-gray-300 hover:border-cyan-500/50 hover:text-white'
            }`}
          >
            {n}
          </button>
        )
      })}
    </div>
  )
}

// ─── Ticket Row ───────────────────────────────────────────────────────────────

function TicketRow({ ticket }: { ticket: Ticket }) {
  const c = DRAW_COLORS[ticket.drawType]
  const isPending = ticket.status === 'pending'

  return (
    <div className={`rounded-xl border p-3 ${isPending ? 'border-game-border bg-game-card' : c.border + ' ' + c.bg}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Draw type + numbers */}
        <div className="flex items-center gap-3">
          <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full border ${c.badgeBg} ${c.badge}`}>
            {DRAW_LABEL[ticket.drawType]}
          </span>
          <div className="flex gap-1">
            {ticket.pickedNumbers.map(n => (
              <span
                key={n}
                className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-mono font-bold ${
                  ticket.winningNumbers?.includes(n)
                    ? 'bg-amber-400 text-gray-950'
                    : 'bg-game-bg border border-game-border text-gray-300'
                }`}
              >
                {n}
              </span>
            ))}
          </div>
        </div>

        {/* Status */}
        {isPending ? (
          <div className="text-right">
            <p className="text-xs text-gray-500">Draw in</p>
            <p className={`text-sm font-semibold ${c.accent}`}>
              <Countdown scheduledAt={ticket.scheduledAt} />
            </p>
          </div>
        ) : (
          <div className="text-right">
            {ticket.prizeCents && ticket.prizeCents > 0 ? (
              <>
                <p className="text-xs text-gray-400">{ticket.matchedCount} matched</p>
                <p className="text-sm font-bold text-amber-400">{formatCents(ticket.prizeCents)}</p>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-400">{ticket.matchedCount ?? 0} matched</p>
                <p className="text-sm text-gray-500">No prize</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Winning numbers for settled tickets */}
      {!isPending && ticket.winningNumbers && (
        <div className="mt-2 pt-2 border-t border-game-border flex items-center gap-2">
          <span className="text-xs text-gray-500">Winning:</span>
          <div className="flex gap-1">
            {ticket.winningNumbers.map(n => (
              <span
                key={n}
                className="inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-mono font-bold bg-amber-400/10 border border-amber-500/30 text-amber-400"
              >
                {n}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LotteryPage() {
  const [draws, setDraws] = useState<Draw[]>([])
  const [drawsLoading, setDrawsLoading] = useState(true)
  const [drawsError, setDrawsError] = useState<string | null>(null)

  const [selectedDrawType, setSelectedDrawType] = useState<DrawType | null>(null)
  const [pickedNumbers, setPickedNumbers] = useState<number[]>([])

  const [buying, setBuying] = useState(false)
  const [buyError, setBuyError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<BuyTicketResponse | null>(null)

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(true)

  // Load draws
  useEffect(() => {
    setDrawsLoading(true)
    apiFetch<DrawsResponse>('/games/lottery/draws')
      .then(data => {
        setDraws(data.draws)
        setDrawsError(null)
      })
      .catch((e: unknown) => {
        setDrawsError(e instanceof Error ? e.message : 'Failed to load draws')
      })
      .finally(() => setDrawsLoading(false))
  }, [])

  // Load my tickets
  const loadTickets = useCallback(() => {
    setTicketsLoading(true)
    apiFetch<TicketsResponse>('/games/lottery/tickets/mine')
      .then(data => setTickets(data.tickets))
      .catch(() => setTickets([]))
      .finally(() => setTicketsLoading(false))
  }, [])

  useEffect(() => {
    loadTickets()
  }, [loadTickets])

  function toggleNumber(n: number) {
    setPickedNumbers(prev => {
      if (prev.includes(n)) return prev.filter(x => x !== n)
      if (prev.length >= 3) return prev
      return [...prev, n]
    })
  }

  function selectDrawType(dt: DrawType) {
    setSelectedDrawType(prev => (prev === dt ? null : dt))
    setConfirmation(null)
    setBuyError(null)
  }

  async function handleBuyTicket() {
    if (!selectedDrawType || pickedNumbers.length !== 3) return
    setBuying(true)
    setBuyError(null)
    setConfirmation(null)
    try {
      const data = await apiFetch<BuyTicketResponse>('/games/lottery/tickets', {
        method: 'POST',
        body: JSON.stringify({ drawType: selectedDrawType, pickedNumbers }),
      })
      setConfirmation(data)
      setPickedNumbers([])
      refreshBalance()
      loadTickets()
    } catch (e: unknown) {
      setBuyError(e instanceof Error ? e.message : 'Purchase failed')
    } finally {
      setBuying(false)
    }
  }

  const selectedDraw = draws.find(d => d.drawType === selectedDrawType) ?? null
  const canBuy = selectedDrawType !== null && pickedNumbers.length === 3

  const pendingTickets = tickets.filter(t => t.status === 'pending')
  const settledTickets = tickets.filter(t => t.status === 'settled')

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold font-mono text-amber-400">LOTTERY</h1>
        <span className="text-xs px-2 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">DRAW</span>
      </div>

      {/* Draw tier cards */}
      {drawsError ? (
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-3 text-warning-coral text-sm">{drawsError}</div>
      ) : drawsLoading ? (
        <div className="flex gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex-1 h-40 bg-game-card border border-game-border rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3">
          {draws.map(draw => (
            <TierCard
              key={draw.id}
              draw={draw}
              selected={selectedDrawType === draw.drawType}
              onSelect={() => selectDrawType(draw.drawType)}
            />
          ))}
        </div>
      )}

      {/* Number picker + buy */}
      <div className="bg-game-card border border-game-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-gray-300">Pick 3 Numbers</p>
          <div className="flex gap-1.5">
            {pickedNumbers.map(n => (
              <span
                key={n}
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-cyan-500 text-gray-950 font-mono font-bold text-sm"
              >
                {n}
              </span>
            ))}
            {Array.from({ length: 3 - pickedNumbers.length }).map((_, i) => (
              <span
                key={`empty-${i}`}
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-dashed border-gray-600 text-gray-600 text-xs"
              >
                ?
              </span>
            ))}
          </div>
        </div>

        <NumberPicker selected={pickedNumbers} onToggle={toggleNumber} />

        {/* Context line */}
        {selectedDraw ? (
          <p className="text-xs text-gray-400">
            Buying for{' '}
            <span className={DRAW_COLORS[selectedDraw.drawType].accent + ' font-semibold'}>
              {DRAW_LABEL[selectedDraw.drawType]}
            </span>{' '}
            draw — ticket costs{' '}
            <span className="text-white font-semibold">{formatCents(selectedDraw.ticketPrice)}</span>
          </p>
        ) : (
          <p className="text-xs text-gray-500">Select a draw tier above to buy a ticket</p>
        )}

        {buyError && (
          <div className="text-warning-coral text-sm bg-red-500/5 border border-red-500/20 rounded-xl px-3 py-2">{buyError}</div>
        )}

        {confirmation && (
          <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl px-4 py-3 space-y-1">
            <p className="text-cyan-400 font-bold text-sm">Ticket purchased!</p>
            <p className="text-gray-400 text-xs font-mono">ID: {confirmation.ticketId}</p>
            <p className="text-gray-400 text-xs">
              Draw at{' '}
              <span className="text-white">
                {new Date(confirmation.scheduledAt).toLocaleString('en-KE', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            </p>
          </div>
        )}

        <button
          onClick={handleBuyTicket}
          disabled={!canBuy || buying}
          className="w-full py-3.5 rounded-xl font-bold text-base disabled:opacity-40 transition-all"
          style={
            canBuy
              ? { background: 'linear-gradient(135deg, #f59e0b, #fbbf24)', color: '#0a0a0a' }
              : { background: '#1a1a2e', color: '#6b7280' }
          }
        >
          {buying
            ? 'Buying...'
            : !selectedDrawType
            ? 'Select a draw tier'
            : pickedNumbers.length < 3
            ? `Pick ${3 - pickedNumbers.length} more number${3 - pickedNumbers.length !== 1 ? 's' : ''}`
            : `Buy Ticket — ${selectedDraw ? formatCents(selectedDraw.ticketPrice) : ''}`}
        </button>
      </div>

      {/* My Tickets */}
      <div className="space-y-4">
        <h2 className="text-base font-bold text-gray-300 font-mono uppercase tracking-widest">My Tickets</h2>

        {ticketsLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-16 bg-game-card border border-game-border rounded-xl animate-pulse" />
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="bg-game-card border border-game-border rounded-xl px-4 py-6 text-center text-gray-500 text-sm">
            No tickets yet. Buy one above to get started.
          </div>
        ) : (
          <>
            {pendingTickets.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 uppercase tracking-widest font-mono">Pending ({pendingTickets.length})</p>
                {pendingTickets.map(t => (
                  <TicketRow key={t.id} ticket={t} />
                ))}
              </div>
            )}
            {settledTickets.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 uppercase tracking-widest font-mono">Settled ({settledTickets.length})</p>
                {settledTickets.map(t => (
                  <TicketRow key={t.id} ticket={t} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
