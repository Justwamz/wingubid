'use client'

import React, { useState, useEffect } from 'react'
import { useCrashGame } from '@/hooks/useCrashGame'
import { BetPanel } from '@/components/game/BetPanel'
import { RoundHistory } from '@/components/game/RoundHistory'
import { LiveLeaderboard } from '@/components/game/LiveLeaderboard'
import { CrashChart } from '@/components/game/CrashChart'
import { HowToPlay } from '@/components/game/HowToPlay'
import { DollarSign, TrendingUp, Rocket } from 'lucide-react'

const HOW_TO_PLAY = [
  { icon: <DollarSign size={16} />, text: 'Enter your stake and place your bet before the round starts.' },
  { icon: <TrendingUp size={16} />, text: 'Watch the multiplier rise. The longer it climbs, the more you win.' },
  { icon: <Rocket size={16} />, text: 'Cash out before it crashes to lock in your winnings. Wait too long and you lose.' },
]

export default function CrashPage() {
  const { status, multiplier, myBet, crashPoint, waitingEndsAt, recentCrashes, feed, error, connected, cashoutResult, placeBet, cashout } =
    useCrashGame()

  const [chartPoints, setChartPoints] = useState<number[]>([])

  useEffect(() => {
    if (status === 'waiting') {
      setChartPoints([])
    } else if (status === 'running') {
      setChartPoints(prev => [...prev, multiplier])
    }
  }, [status, multiplier])

  const multiplierColor = status === 'crashed' ? 'text-warning-coral' : 'text-accent-cyan'
  const multiplierLabel =
    status === 'waiting' ? 'WAITING...'
    : status === 'crashed' ? `CRASHED @ ${crashPoint?.toFixed(2)}×`
    : `${multiplier.toFixed(2)}×`

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold font-mono text-accent-cyan">CRASH</h1>
        <span className="text-xs px-2 py-1 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">LIVE</span>
      </div>

      <HowToPlay steps={HOW_TO_PLAY} />

      {cashoutResult && (
        <div className="w-full bg-green-900/60 border border-green-500/40 rounded-xl px-4 py-3 text-center">
          <p className="text-green-400 font-bold text-lg">
            Cashed out at {cashoutResult.multiplier.toFixed(2)}× · KES {(cashoutResult.winnings / 100).toFixed(2)}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart + bet panel */}
        <div className="lg:col-span-2 space-y-4">
          <div
            data-testid="crash-chart"
            className="relative bg-game-card border border-game-border rounded-2xl overflow-hidden h-56 lg:h-72"
          >
            <CrashChart points={chartPoints} status={status === 'idle' ? 'waiting' : status} />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className={`text-4xl lg:text-5xl font-extrabold tracking-tight drop-shadow ${multiplierColor}`}>
                {multiplierLabel}
              </span>
            </div>
          </div>

          <BetPanel
            status={status}
            myBet={myBet}
            multiplier={multiplier}
            connected={connected}
            waitingEndsAt={waitingEndsAt}
            error={error}
            onPlaceBet={placeBet}
            onCashout={cashout}
          />
        </div>

        {/* Sidebar: history + leaderboard */}
        <div className="space-y-4">
          <RoundHistory crashes={recentCrashes} />
          <LiveLeaderboard feed={feed} />
        </div>
      </div>
    </div>
  )
}
