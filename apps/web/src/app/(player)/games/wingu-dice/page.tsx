'use client'

import React, { useState, useRef, useEffect } from 'react'
import { DiceTrack } from '@/components/game/DiceTrack'
import { HowToPlay } from '@/components/game/HowToPlay'
import { GameBetHistory } from '@/components/game/GameBetHistory'
import { QuickStakes } from '@/components/game/QuickStakes'
import { BonusToggle } from '@/components/game/BonusToggle'
import { DEFAULT_STAKE_KES } from '@/lib/gameConfig'
import { apiFetch } from '@/lib/apiFetch'
import { displayedWinCents, bonusWinNote } from '@/lib/bonusWin'
import { refreshBalance } from '@/lib/auth'
import { Target, ArrowUp, Dice6 } from 'lucide-react'

type Direction = 'over' | 'under'

interface RollResult {
  roll: number
  won: boolean
  winnings: number
  netCredited?: number
  fundSource?: 'cash' | 'bonus'
  capped?: boolean
}

// The dice API returns the landed number in `result`; map it to the view model's
// `roll`. (Bug fix: the page previously read `data.roll`, which never existed.)
interface DiceRollResponse {
  result: number
  won: boolean
  winnings: number
  netCredited: number
  fundSource: 'cash' | 'bonus'
  capped: boolean
}

const HOW_TO_PLAY = [
  { icon: <Target size={16} />, text: 'Drag the target on the track. The green zone is where you win, red is where you lose.' },
  { icon: <ArrowUp size={16} />, text: 'Choose HIGH (roll above target) or LOW (roll below). A smaller win zone pays a bigger multiplier.' },
  { icon: <Dice6 size={16} />, text: 'Enter your stake and roll. The number lands on the track - green means you won.' },
]

export default function WinguDicePage() {
  const [target, setTarget] = useState(50)
  const [direction, setDirection] = useState<Direction>('over')
  const [grossStake, setGrossStake] = useState(String(DEFAULT_STAKE_KES))
  const [result, setResult] = useState<RollResult | null>(null)
  const [rolling, setRolling] = useState(false)
  const [spinValue, setSpinValue] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rollCount, setRollCount] = useState(0)
  const [houseEdge, setHouseEdge] = useState(5)
  const [fundSource, setFundSource] = useState<'cash' | 'bonus'>('cash')
  const [bonusBalance, setBonusBalance] = useState(0)
  const spinRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (spinRef.current) clearInterval(spinRef.current) }, [])

  // Load the configured house edge so the displayed multiplier always matches
  // what the server actually pays.
  useEffect(() => {
    apiFetch<{ houseEdge: { dice: number } }>('/games/config')
      .then(d => { if (d?.houseEdge?.dice != null) setHouseEdge(d.houseEdge.dice) })
      .catch(() => {})
  }, [])

  // Load the player's bonus balance (same event the header listens on, so it
  // stays in sync after every roll).
  useEffect(() => {
    function loadBonusBalance() {
      apiFetch<{ bonus_balance: number }>('/wallet/balance')
        .then(d => setBonusBalance(d.bonus_balance ?? 0))
        .catch(() => {})
    }
    loadBonusBalance()
    window.addEventListener('balanceRefresh', loadBonusBalance)
    return () => window.removeEventListener('balanceRefresh', loadBonusBalance)
  }, [])

  // Bonus and cash cannot be mixed in a single bet - cap the stake at the
  // available bonus whenever the player is betting with bonus funds.
  useEffect(() => {
    if (fundSource !== 'bonus') return
    const capKes = bonusBalance / 100
    setGrossStake(prev => {
      const num = parseFloat(prev) || 0
      return num > capKes ? String(capKes) : prev
    })
  }, [fundSource, bonusBalance])

  // If the bonus balance is depleted while betting with bonus, fall back to
  // cash so betting doesn't silently no-op / get rejected by the server.
  useEffect(() => {
    if (bonusBalance <= 0 && fundSource === 'bonus') setFundSource('cash')
  }, [bonusBalance, fundSource])

  function updateStake(v: string) {
    if (fundSource === 'bonus') {
      const capKes = bonusBalance / 100
      const num = parseFloat(v)
      if (!isNaN(num) && num > capKes) v = String(capKes)
    }
    setGrossStake(v)
  }

  const winChance = direction === 'over' ? 100 - target : target
  // Mirror the server payout formula exactly (floored to 2 decimals).
  const multiplier = winChance > 0 ? Math.floor(((100 - houseEdge) / winChance) * 100) / 100 : 0
  const potentialWin = Math.floor((parseFloat(grossStake) || 0) * multiplier)

  async function handleRoll() {
    const stake = parseFloat(grossStake)
    if (!stake || stake <= 0) return
    setRolling(true)
    setError(null)
    setResult(null)
    // Odometer spin: cycle random numbers so the roll clearly feels like it's
    // happening, for at least ~1.4s of suspense before it lands.
    setSpinValue(Math.floor(Math.random() * 101))
    spinRef.current = setInterval(() => setSpinValue(Math.floor(Math.random() * 101)), 60)
    const started = Date.now()
    try {
      const data = await apiFetch<DiceRollResponse>('/games/dice/roll', {
        method: 'POST',
        body: JSON.stringify({ grossStake: Math.floor(stake * 100), target, direction, fundSource }),
      })
      await new Promise(r => setTimeout(r, Math.max(0, 1400 - (Date.now() - started))))
      if (spinRef.current) { clearInterval(spinRef.current); spinRef.current = null }
      setSpinValue(null)
      setResult({
        roll: data.result,
        won: data.won,
        winnings: data.winnings,
        netCredited: data.netCredited,
        fundSource: data.fundSource,
        capped: data.capped,
      })
      setRollCount(c => c + 1)
      refreshBalance()
    } catch (e: unknown) {
      if (spinRef.current) { clearInterval(spinRef.current); spinRef.current = null }
      setSpinValue(null)
      setError(e instanceof Error ? e.message : "Your roll couldn't be completed. Please try again.")
    } finally {
      setRolling(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold font-mono" style={{ color: '#00C896' }}>WINGU DICE</h1>
        <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">INSTANT</span>
      </div>

      <p className="text-sm text-gray-500">
        A random number from 0 to 100 is rolled. You win if it lands in your green zone.
      </p>

      <HowToPlay steps={HOW_TO_PLAY} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main game area */}
        <div className="lg:col-span-2 space-y-4">
          {/* Result display */}
          <div className="bg-game-card border border-game-border rounded-2xl p-6 flex flex-col items-center gap-4">
            {rolling ? (
              <div className="text-center">
                <p className="text-6xl font-extrabold tabular-nums text-white">{spinValue ?? 0}</p>
                <p className="text-lg font-bold mt-1 text-gray-400 animate-pulse">Rolling…</p>
              </div>
            ) : result ? (
              <div key={rollCount} className="text-center">
                <p className="dice-pop text-6xl font-extrabold tabular-nums" style={{ color: result.won ? '#00C896' : '#FF4E50' }}>
                  {result.roll}
                </p>
                <p className={`dice-pop text-lg font-bold mt-1 ${result.won ? 'text-accent-cyan' : 'text-warning-coral'}`}>
                  {result.won ? `WIN · +KES ${(displayedWinCents(result) / 100).toFixed(0)}` : 'LOSS'}
                </p>
                {result.won && bonusWinNote(result) && (
                  <p className="text-accent-cyan/70 text-xs">{bonusWinNote(result)}</p>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-lg py-2">Set your bet and roll</p>
            )}

            {/* One-sentence bet */}
            <div className="flex flex-wrap items-center justify-center gap-2 text-base">
              <span className="text-gray-400">Bet the roll lands</span>
              <div className="inline-flex rounded-lg overflow-hidden border border-game-border">
                {(['over', 'under'] as Direction[]).map(d => (
                  <button
                    key={d}
                    onClick={() => setDirection(d)}
                    disabled={rolling}
                    className={`px-3 py-1.5 text-sm font-bold transition-colors disabled:opacity-50 ${
                      direction === d ? 'text-black' : 'bg-game-bg text-gray-400 hover:text-white'
                    }`}
                    style={direction === d ? { background: '#00C896' } : undefined}
                  >
                    {d === 'over' ? 'OVER' : 'UNDER'}
                  </button>
                ))}
              </div>
              <span className="text-white font-extrabold text-lg tabular-nums">{target}</span>
              <span className="text-gray-400">to win</span>
              <span className="font-extrabold" style={{ color: '#00C896' }}>KES {potentialWin.toLocaleString('en-KE')}</span>
            </div>

            {/* Chance / multiplier */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span><span className="text-white font-bold">{winChance}%</span> chance</span>
                <span className="text-gray-600">·</span>
                <span>pays <span className="text-accent-cyan font-bold">{multiplier.toFixed(2)}×</span></span>
              </div>
              <p className="text-xs text-gray-600">Smaller green zone = bigger payout</p>
            </div>
          </div>

          {/* Win/lose track */}
          <div className="bg-game-card border border-game-border rounded-2xl p-4">
            <DiceTrack
              target={target}
              onChange={setTarget}
              direction={direction}
              result={result?.roll ?? null}
              won={result?.won ?? null}
              rollingValue={spinValue}
            />
          </div>

          {/* Bet controls */}
          <div className="bg-game-card border border-game-border rounded-2xl p-4 space-y-3">
            <BonusToggle bonusBalance={bonusBalance} value={fundSource} onChange={setFundSource} disabled={rolling} />
            <input
              type="number"
              placeholder="Stake amount (KES)"
              value={grossStake}
              onChange={e => updateStake(e.target.value)}
              className="w-full bg-game-bg border border-game-border rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-accent-cyan text-sm"
            />
            <QuickStakes
              onSelect={v => updateStake(String(v))}
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
