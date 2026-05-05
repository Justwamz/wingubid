'use client'
import { useState, useEffect } from 'react'
import type { RoundStatus, MyBet } from '@/hooks/useCrashGame'
import { CheckCircle2 } from 'lucide-react'

interface Props {
  status: RoundStatus
  myBet: MyBet | null
  multiplier?: number
  waitingEndsAt?: number | null
  error?: string | null
  connected?: boolean
  onPlaceBet: (grossStake: number, autoCashoutAt?: number) => void
  onCashout: () => void
}

export function BetPanel({ status, myBet, multiplier = 1, waitingEndsAt, error, connected, onPlaceBet, onCashout }: Props) {
  const [stake, setStake] = useState('')
  const [autoCashout, setAutoCashout] = useState('')
  const [showAuto, setShowAuto] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)

  const canBet = status === 'waiting' && !myBet
  const canCashout = status === 'running' && !!myBet

  useEffect(() => {
    if (status !== 'waiting' || !waitingEndsAt) {
      setSecondsLeft(null)
      return
    }
    function update() {
      const remaining = Math.max(0, Math.ceil((waitingEndsAt! - Date.now()) / 1000))
      setSecondsLeft(remaining)
    }
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [status, waitingEndsAt])

  function handleSubmit() {
    const amount = parseInt(stake)
    if (!amount || amount <= 0) return
    const auto = parseFloat(autoCashout) || undefined
    onPlaceBet(amount * 100, auto)
  }

  return (
    <div className="bg-game-card border border-game-border rounded-xl p-4 space-y-3">
      {(!connected || status === 'idle') && (
        <div className="text-xs text-gray-500 text-center py-1 animate-pulse">Connecting to game…</div>
      )}

      <div className="flex gap-2">
        <input
          type="number"
          placeholder="Stake (KES)"
          value={stake}
          onChange={e => setStake(e.target.value)}
          disabled={!canBet}
          className="flex-1 bg-game-bg border border-game-border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-accent-cyan disabled:opacity-40"
        />
      </div>

      <div className="flex gap-2">
        {[100, 500, 1000].map(v => (
          <button
            key={v}
            onClick={() => setStake(String(v))}
            disabled={!canBet}
            className="flex-1 bg-game-bg border border-game-border rounded-lg py-1 text-sm text-gray-300 hover:border-accent-cyan disabled:opacity-40"
          >
            +{v}
          </button>
        ))}
      </div>

      <button
        onClick={() => setShowAuto(!showAuto)}
        className="text-xs text-accent-violet underline"
      >
        {showAuto ? 'Hide' : 'Auto cashout'}
      </button>

      {showAuto && (
        <input
          type="number"
          placeholder="Auto cashout at (e.g. 2.00)"
          value={autoCashout}
          onChange={e => setAutoCashout(e.target.value)}
          step="0.01"
          className="w-full bg-game-bg border border-game-border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-accent-cyan"
        />
      )}

      {status === 'waiting' && secondsLeft !== null && (
        <p className="text-xs text-center text-accent-cyan">Betting closes in {secondsLeft}s</p>
      )}

      {status === 'running' && !myBet && (
        <p className="text-xs text-center text-yellow-400">Round in progress · wait for the next round to bet</p>
      )}

      {canCashout ? (
        <button
          onClick={onCashout}
          className="w-full py-3 rounded-xl font-bold text-game-bg bg-accent-cyan text-lg animate-pulse"
        >
          Cash Out @ {multiplier.toFixed(2)}×
        </button>
      ) : myBet ? (
        <button disabled className="w-full py-3 rounded-xl font-bold text-game-bg bg-gray-500 text-lg opacity-60">
          Bet Placed<CheckCircle2 size={16} className="inline ml-1" />
        </button>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={!canBet}
          className="w-full py-3 rounded-xl font-bold text-game-bg bg-accent-cyan text-lg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Place Bet
        </button>
      )}

      {error && <p className="text-xs text-red-400 text-center">{error}</p>}
    </div>
  )
}
