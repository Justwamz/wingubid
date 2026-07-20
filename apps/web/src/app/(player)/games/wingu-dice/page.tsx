'use client'

import React, { useState } from 'react'
import { DiceSlider } from '@/components/game/DiceSlider'
import { DiceFace } from '@/components/game/DiceFace'
import { HowToPlay } from '@/components/game/HowToPlay'
import { GameBetHistory } from '@/components/game/GameBetHistory'
import { QuickStakes } from '@/components/game/QuickStakes'
import { DEFAULT_STAKE_KES } from '@/lib/gameConfig'
import { apiFetch } from '@/lib/apiFetch'
import { refreshBalance } from '@/lib/auth'
import { Target, ArrowUp, Dice6 } from 'lucide-react'

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

const HOW_TO_PLAY = [
  { icon: <Target size={16} />, text: 'Set your target number using the slider.' },
  { icon: <ArrowUp size={16} />, text: 'Choose HIGH (roll above target) or LOW (roll below). Tighter range = bigger multiplier.' },
  { icon: <Dice6 size={16} />, text: 'Enter your stake and roll. Win instantly if the result matches your prediction.' },
]

export default function WinguDicePage() {
  const [target, setTarget] = useState(50)
  const [direction, setDirection] = useState<Direction>('over')
  const [grossStake, setGrossStake] = useState(String(DEFAULT_STAKE_KES))
  const [result, setResult] = useState<RollResult | null>(null)
  const [rolling, setRolling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rollCount, setRollCount] = useState(0)

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
        body: JSON.stringify({ grossStake: Math.floor(stake * 100), target, direction }),
      })
      setResult(data)
      setRollCount(c => c + 1)
      refreshBalance()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Your roll couldn't be completed. Please try again.")
    } finally {
      setRolling(false)
    }
  }

  const faceValue = result ? rollToFace(result.roll) : 1

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold font-mono" style={{ color: '#00C896' }}>WINGU DICE</h1>
        <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">INSTANT</span>
      </div>

      <HowToPlay steps={HOW_TO_PLAY} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main game area */}
        <div className="lg:col-span-2 space-y-4">
          {/* Result display */}
          <div className="bg-game-card border border-game-border rounded-2xl p-6 flex flex-col items-center gap-4">
            <div className="flex gap-6 items-center">
              <DiceFace value={faceValue} size={96} won={result?.won ?? false} />
              {result ? (
                <div className="text-center">
                  <p className="text-5xl font-extrabold text-white tabular-nums">{result.roll}</p>
                  <p className={`text-lg font-bold mt-1 ${result.won ? 'text-accent-cyan' : 'text-warning-coral'}`}>
                    {result.won ? `+KES ${(result.winnings / 100).toFixed(0)} WON` : 'LOST'}
                  </p>
                </div>
              ) : (
                <p className="text-gray-500 text-lg">Roll to start</p>
              )}
            </div>

            {/* Direction buttons */}
            <div className="flex gap-3 w-full max-w-xs">
              {(['over', 'under'] as Direction[]).map(d => (
                <button
                  key={d}
                  onClick={() => setDirection(d)}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${
                    direction === d
                      ? 'bg-accent-violet text-white shadow-lg shadow-violet-900/30'
                      : 'bg-game-bg text-gray-400 border border-game-border hover:border-gray-500'
                  }`}
                >
                  {d === 'over' ? '⬆ HIGH' : '⬇ LOW'}
                </button>
              ))}
            </div>

            {/* Stats */}
            <div className="flex gap-8 text-center">
              <div><p className="text-white font-bold text-lg">{target}</p><p className="text-gray-500 text-xs">Target</p></div>
              <div><p className="text-white font-bold text-lg">{winChance}%</p><p className="text-gray-500 text-xs">Win Chance</p></div>
              <div><p className="text-accent-cyan font-bold text-lg">{multiplier}×</p><p className="text-gray-500 text-xs">Multiplier</p></div>
            </div>
          </div>

          {/* Slider */}
          <div className="bg-game-card border border-game-border rounded-2xl p-4">
            <DiceSlider value={target} onChange={setTarget} />
          </div>

          {/* Bet controls */}
          <div className="bg-game-card border border-game-border rounded-2xl p-4 space-y-3">
            <input
              type="number"
              placeholder="Stake amount (KES)"
              value={grossStake}
              onChange={e => setGrossStake(e.target.value)}
              className="w-full bg-game-bg border border-game-border rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-accent-cyan text-sm"
            />
            <QuickStakes
              onSelect={v => setGrossStake(String(v))}
              disabled={rolling}
              activeValue={parseInt(grossStake) || undefined}
            />
            {error && <p className="text-warning-coral text-sm">{error}</p>}
            <button
              onClick={handleRoll}
              disabled={rolling || !grossStake}
              className="w-full py-3.5 rounded-xl font-bold text-base disabled:opacity-40 transition-all"
              style={{ background: 'linear-gradient(135deg, #00C896, #00F2FE)', color: '#0a0a0a' }}
            >
              {rolling ? 'ROLLING...' : 'ROLL DICE'}
            </button>
          </div>
        </div>

        {/* History sidebar */}
        <div>
          <GameBetHistory game="dice" title="Recent Rolls" refreshKey={rollCount} />
        </div>
      </div>
    </div>
  )
}
