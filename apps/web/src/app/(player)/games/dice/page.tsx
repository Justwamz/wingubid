'use client'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import { sounds } from '@/lib/sounds'
import { haptics } from '@/lib/haptics'
import { DiceSlider } from '@/components/game/DiceSlider'

interface RollResult {
  result: number; won: boolean; multiplier: number; winnings: number
  serverSeed: string; clientSeed: string; nonce: number
}

export default function DicePage() {
  const [stake, setStake] = useState('')
  const [target, setTarget] = useState(50)
  const [direction, setDirection] = useState<'over' | 'under'>('over')
  const [rolling, setRolling] = useState(false)
  const [lastRoll, setLastRoll] = useState<RollResult | null>(null)
  const [history, setHistory] = useState<boolean[]>([])
  const [error, setError] = useState<string | null>(null)

  const houseEdge = 1
  const winCount = direction === 'over' ? 100 - target : target
  const multiplier = Math.floor(((100 - houseEdge) / winCount) * 100) / 100
  const winChance = winCount

  async function handleRoll() {
    const amount = parseInt(stake)
    if (!amount || amount <= 0) return
    setRolling(true); setError(null)
    const { data, error: err } = await apiFetch<RollResult>('/games/dice/roll', {
      method: 'POST',
      body: JSON.stringify({ grossStake: amount, target, direction }),
    })
    setRolling(false)
    if (err) { setError(err.message); return }
    setLastRoll(data!)
    setHistory(prev => [data!.won, ...prev].slice(0, 10))
    if (data!.won) { sounds.win(); haptics.win() }
    else { sounds.lose(); haptics.lose() }
  }

  return (
    <div className="min-h-screen bg-game-bg text-white flex flex-col p-4 gap-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-accent-cyan font-mono">DICE</h1>

      {lastRoll && (
        <div className={`text-center py-4 rounded-xl border ${lastRoll.won ? 'border-accent-cyan' : 'border-warning-coral'}`}>
          <p className="font-mono text-6xl font-bold" style={{ color: lastRoll.won ? '#00F2FE' : '#FF4E50' }}>
            {lastRoll.result}
          </p>
          <p className="text-sm mt-1" style={{ color: lastRoll.won ? '#00F2FE' : '#FF4E50' }}>
            {lastRoll.won ? `+KES ${lastRoll.winnings}` : 'No win'}
          </p>
        </div>
      )}

      <DiceSlider target={target} direction={direction} onChange={setTarget} result={lastRoll?.result ?? null} />

      <div className="flex gap-3 text-sm text-gray-400">
        <span>Win chance: <strong className="text-white">{winChance}%</strong></span>
        <span>Payout: <strong className="text-accent-cyan">{multiplier.toFixed(2)}×</strong></span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setDirection('over')}
          className={`flex-1 py-2 rounded-xl font-bold border ${direction === 'over' ? 'border-accent-cyan text-accent-cyan' : 'border-game-border text-gray-400'}`}
        >
          ROLL OVER
        </button>
        <button
          onClick={() => setDirection('under')}
          className={`flex-1 py-2 rounded-xl font-bold border ${direction === 'under' ? 'border-warning-coral text-warning-coral' : 'border-game-border text-gray-400'}`}
        >
          ROLL UNDER
        </button>
      </div>

      <input
        type="number"
        placeholder="Stake (KES)"
        value={stake}
        onChange={e => setStake(e.target.value)}
        className="w-full bg-game-card border border-game-border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-accent-cyan"
      />

      <button
        onClick={handleRoll}
        disabled={rolling || !stake}
        className="w-full py-3 rounded-xl font-bold text-game-bg bg-accent-cyan text-lg disabled:opacity-40"
      >
        {rolling ? 'Rolling…' : 'Roll'}
      </button>

      <div className="flex gap-1">
        {history.map((won, i) => (
          <div key={i} className="w-3 h-3 rounded-full" style={{ background: won ? '#00F2FE' : '#FF4E50' }} />
        ))}
      </div>

      {error && <p className="text-warning-coral text-sm text-center">{error}</p>}
    </div>
  )
}
