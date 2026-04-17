'use client'

import React, { useState } from 'react'
import { DiceSlider } from '@/components/game/DiceSlider'
import { DiceFace } from '@/components/game/DiceFace'
import { apiFetch } from '@/lib/apiFetch'

type Direction = 'over' | 'under'

interface RollResult {
  roll: number
  won: boolean
  winnings: number
  newBalance: number
}

function rollToFace(roll: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return (Math.ceil((roll / 100) * 6) || 1) as 1 | 2 | 3 | 4 | 5 | 6
}

export default function DicePage() {
  const [target, setTarget] = useState(50)
  const [direction, setDirection] = useState<Direction>('over')
  const [grossStake, setGrossStake] = useState('')
  const [result, setResult] = useState<RollResult | null>(null)
  const [rolling, setRolling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<RollResult[]>([])

  const winChance = direction === 'over' ? 100 - target : target
  const multiplier = winChance > 0 ? parseFloat((99 / winChance).toFixed(4)) : 0

  async function handleRoll() {
    const stake = parseFloat(grossStake)
    if (!stake || stake <= 0) return
    setRolling(true)
    setError(null)
    try {
      const data = await apiFetch<RollResult>('/games/dice/roll', {
        method: 'POST',
        body: JSON.stringify({ grossStake: stake, target, direction }),
      })
      setResult(data)
      setHistory(prev => [data, ...prev].slice(0, 10))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Roll failed')
    } finally {
      setRolling(false)
    }
  }

  const faceValue = result ? rollToFace(result.roll) : 1

  return (
    <div className="min-h-screen bg-game-bg p-4 space-y-4">
      <h1 className="text-white text-xl font-bold">Dice</h1>

      <div className="bg-game-card border border-game-border rounded-xl p-6 flex flex-col items-center gap-3">
        <div className="flex gap-4 items-center">
          <DiceFace value={faceValue} size={80} won={result?.won ?? false} />
          {result && (
            <div className="text-center">
              <p className="text-3xl font-extrabold text-white">{result.roll}</p>
              <p className={`text-sm font-semibold ${result.won ? 'text-accent-cyan' : 'text-warning-coral'}`}>
                {result.won ? `+${result.winnings} WON` : 'LOST'}
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {(['over', 'under'] as Direction[]).map(d => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              className={`px-5 py-2 rounded-full text-sm font-bold transition-colors ${
                direction === d
                  ? 'bg-accent-violet text-white'
                  : 'bg-game-bg text-gray-400 border border-game-border'
              }`}
            >
              {d === 'over' ? 'HIGH' : 'LOW'}
            </button>
          ))}
        </div>

        <div className="flex gap-6 text-center text-xs text-gray-400">
          <div><p className="text-white font-semibold">{target}</p><p>Target</p></div>
          <div><p className="text-white font-semibold">{winChance}%</p><p>Win Chance</p></div>
          <div><p className="text-white font-semibold">{multiplier}×</p><p>Multiplier</p></div>
        </div>
      </div>

      <div className="bg-game-card border border-game-border rounded-xl p-4">
        <DiceSlider value={target} onChange={setTarget} />
      </div>

      <div className="bg-game-card border border-game-border rounded-xl p-4 space-y-3">
        <input
          type="number"
          placeholder="Stake amount"
          value={grossStake}
          onChange={e => setGrossStake(e.target.value)}
          className="w-full bg-game-bg border border-game-border rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-accent-cyan"
        />
        {error && <p className="text-warning-coral text-sm">{error}</p>}
        <button
          onClick={handleRoll}
          disabled={rolling || !grossStake}
          className="w-full py-3 rounded-xl bg-accent-violet text-white font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {rolling ? 'ROLLING...' : 'ROLL DICE'}
        </button>
      </div>

      {history.length > 0 && (
        <div className="bg-game-card border border-game-border rounded-xl p-4 space-y-2">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Recent Rolls</p>
          <div className="flex flex-wrap gap-2">
            {history.map((r, i) => (
              <span
                key={i}
                className={`text-xs font-bold px-2 py-1 rounded ${
                  r.won ? 'bg-accent-cyan/10 text-accent-cyan' : 'bg-warning-coral/10 text-warning-coral'
                }`}
              >
                {r.roll}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
