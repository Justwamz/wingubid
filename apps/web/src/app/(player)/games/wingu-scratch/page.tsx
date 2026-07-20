'use client'

import React, { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/apiFetch'
import { refreshBalance } from '@/lib/auth'
import { HowToPlay } from '@/components/game/HowToPlay'
import { BetHistory, type BetHistoryEntry } from '@/components/game/BetHistory'
import { DEFAULT_STAKE_KES } from '@/lib/gameConfig'
import { DollarSign, Ticket, Trophy } from 'lucide-react'

const HOW_TO_PLAY = [
  { icon: <DollarSign size={16} />, text: 'Choose your stake: KES 20, 50, 100 or 200.' },
  { icon: <Ticket size={16} />, text: 'Hit Buy & Scratch. A 3×3 grid of hidden tiles is generated instantly on the server.' },
  { icon: <Trophy size={16} />, text: 'Match 3 or more of the same symbol to win. The rarer the symbol, the bigger the prize!' },
]

// Symbol index → emoji
const SYMBOLS = ['💎', '🌟', '🍀', '🔥', '💰', '❌'] as const

const STAKES = [
  { label: 'KES 20', cents: 2000 },
  { label: 'KES 50', cents: 5000 },
  { label: 'KES 100', cents: 10000 },
  { label: 'KES 200', cents: 20000 },
]

// Default to the tile matching the shared default stake, else the first tile.
const DEFAULT_STAKE_CENTS =
  (STAKES.find(s => s.cents === DEFAULT_STAKE_KES * 100) ?? STAKES[0]).cents

interface BuyResponse {
  cardId: string
  grid: number[]
  prizeCents: number
}

interface HistoryCard {
  id: string
  stakeCents: number
  grid: number[]
  prizeCents: number
  createdAt: string
}

interface HistoryResponse {
  cards: HistoryCard[]
}

function symbolOf(index: number): string {
  return SYMBOLS[index] ?? '?'
}

function detectWin(grid: number[]): boolean {
  if (grid.length !== 9) return false
  // Count occurrences of each non-❌ (index 5) symbol
  const counts: Record<number, number> = {}
  for (const sym of grid) {
    if (sym !== 5) counts[sym] = (counts[sym] ?? 0) + 1
  }
  return Object.values(counts).some(c => c >= 3)
}

// ─── Tile component ─────────────────────────────────────────────────────────

interface TileProps {
  symbolIndex: number
  revealed: boolean
  delayMs: number
}

function Tile({ symbolIndex, revealed, delayMs }: TileProps) {
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    if (!revealed) {
      setFlipped(false)
      return
    }
    const t = setTimeout(() => setFlipped(true), delayMs)
    return () => clearTimeout(t)
  }, [revealed, delayMs])

  const isX = symbolIndex === 5

  return (
    <div className="relative w-full aspect-square" style={{ perspective: '400px' }}>
      <div
        className="absolute inset-0 transition-transform duration-500"
        style={{
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* Front (face-down) */}
        <div
          className="absolute inset-0 rounded-xl flex items-center justify-center border border-gray-700/60"
          style={{
            backfaceVisibility: 'hidden',
            background: 'linear-gradient(135deg, #1c1c2e, #2a2a3e)',
          }}
        >
          <span className="text-2xl font-bold text-gray-500 select-none">?</span>
        </div>

        {/* Back (revealed) */}
        <div
          className={`absolute inset-0 rounded-xl flex items-center justify-center border transition-colors ${
            isX
              ? 'border-red-500/30 bg-red-950/40'
              : 'border-yellow-500/30 bg-yellow-950/20'
          }`}
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          <span className="text-2xl select-none">{symbolOf(symbolIndex)}</span>
        </div>
      </div>
    </div>
  )
}

// ─── History mapping ─────────────────────────────────────────────────────────

function cardToEntry(card: HistoryCard): BetHistoryEntry {
  return {
    id: card.id,
    stake: card.stakeCents,
    status: card.prizeCents > 0 ? 'won' : 'lost',
    payout: card.prizeCents,
    multiplier: null,
    createdAt: card.createdAt,
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WinguScratchPage() {
  const [selectedStake, setSelectedStake] = useState(DEFAULT_STAKE_CENTS)
  const [buying, setBuying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [card, setCard] = useState<BuyResponse | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [showBanner, setShowBanner] = useState(false)

  const [history, setHistory] = useState<HistoryCard[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)

  // Load history on mount
  useEffect(() => {
    apiFetch<HistoryResponse>('/games/scratch/history')
      .then(res => {
        setHistory((res.cards ?? []).slice(0, 5))
        setHistoryLoaded(true)
      })
      .catch(() => setHistoryLoaded(true))
  }, [])

  async function handleBuy() {
    setBuying(true)
    setError(null)
    setCard(null)
    setRevealed(false)
    setShowBanner(false)

    try {
      const data = await apiFetch<BuyResponse>('/games/scratch/buy', {
        method: 'POST',
        body: JSON.stringify({ stake: selectedStake }),
      })

      setCard(data)

      // Start reveal animation after a short pause
      setTimeout(() => {
        setRevealed(true)

        // Show win banner after all tiles have flipped (9 * 300ms + buffer)
        const totalRevealMs = 9 * 300 + 600
        setTimeout(() => {
          if (detectWin(data.grid) && data.prizeCents > 0) {
            setShowBanner(true)
          }
        }, totalRevealMs)
      }, 200)

      refreshBalance()

      // Prepend to history
      setHistory(prev =>
        [
          {
            id: data.cardId,
            stakeCents: selectedStake,
            grid: data.grid,
            prizeCents: data.prizeCents,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 5),
      )
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "We couldn't buy your scratch card. Please try again.")
    } finally {
      setBuying(false)
    }
  }

  const isWin = card !== null && card.prizeCents > 0

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1
          className="text-2xl font-extrabold font-mono"
          style={{ color: '#F5C518' }}
        >
          WINGU SCRATCH
        </h1>
        <span className="text-xs px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-300 border border-yellow-500/20 font-mono">
          INSTANT
        </span>
      </div>

      <HowToPlay steps={HOW_TO_PLAY} />

      {/* How to play */}
      <div className="bg-game-card border border-game-border rounded-2xl p-4">
        <p className="text-xs text-gray-500 font-mono font-bold uppercase tracking-widest mb-2">
          How to Play
        </p>
        <div className="space-y-1 text-sm text-gray-400">
          <p>Pick a stake and buy a card.</p>
          <p>Match 3+ of the same symbol (not ❌) anywhere on the 3×3 grid to win.</p>
          <p>Higher stakes = bigger prizes.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main play area */}
        <div className="lg:col-span-2 space-y-4">
          {/* Stake picker */}
          <div className="bg-game-card border border-game-border rounded-2xl p-4 space-y-3">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-mono font-bold">
              Select Stake
            </p>
            <div className="grid grid-cols-4 gap-2">
              {STAKES.map(s => (
                <button
                  key={s.cents}
                  onClick={() => setSelectedStake(s.cents)}
                  className={`py-2.5 rounded-xl font-mono font-bold text-sm border transition-all ${
                    selectedStake === s.cents
                      ? 'border-yellow-400 text-yellow-300 bg-yellow-500/10 shadow-lg shadow-yellow-900/20'
                      : 'border-game-border text-gray-400 hover:border-gray-500'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {error && (
              <p className="text-warning-coral text-sm bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-2">
                {error}
              </p>
            )}

            <button
              onClick={handleBuy}
              disabled={buying}
              className="w-full py-3.5 rounded-xl font-bold text-base disabled:opacity-40 transition-all"
              style={{
                background: 'linear-gradient(135deg, #F5C518, #FF9500)',
                color: '#0a0a0a',
              }}
            >
              {buying ? 'Scratching…' : '🎟️ Buy & Scratch'}
            </button>
          </div>

          {/* Win banner */}
          {showBanner && card && (
            <div
              className="rounded-2xl p-5 text-center border border-yellow-400/40 animate-pulse"
              style={{
                background: 'linear-gradient(135deg, rgba(245,197,24,0.15), rgba(255,149,0,0.15))',
              }}
            >
              <p className="text-3xl font-extrabold text-yellow-300 mb-1">
                🎉 YOU WIN!
              </p>
              <p className="text-xl font-bold text-white">
                KES {(card.prizeCents / 100).toFixed(0)}
              </p>
            </div>
          )}

          {/* Result — no win */}
          {card && !showBanner && revealed && !isWin && (
            <div className="rounded-2xl p-4 text-center border border-red-500/20 bg-red-500/5">
              <p className="text-lg font-bold text-red-400">No matching symbols. Better luck next time!</p>
            </div>
          )}

          {/* Card grid */}
          {card && (
            <div className="bg-game-card border border-game-border rounded-2xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-widest font-mono font-bold mb-3">
                Your Card
              </p>
              <div className="grid grid-cols-3 gap-2">
                {card.grid.map((sym, i) => (
                  <Tile
                    key={i}
                    symbolIndex={sym}
                    revealed={revealed}
                    delayMs={i * 300}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Placeholder when no card yet */}
          {!card && (
            <div className="bg-game-card border border-game-border rounded-2xl p-6 flex flex-col items-center gap-3">
              <div className="grid grid-cols-3 gap-2 w-48 opacity-30">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-square rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center"
                  >
                    <span className="text-xl text-gray-600">?</span>
                  </div>
                ))}
              </div>
              <p className="text-gray-600 text-sm">Buy a card to start</p>
            </div>
          )}
        </div>

        {/* History sidebar */}
        <div className="space-y-3">
          <BetHistory
            title="Recent Cards"
            entries={history.map(cardToEntry)}
            loading={!historyLoaded}
            emptyText="No cards played yet"
          />
        </div>
      </div>
    </div>
  )
}
