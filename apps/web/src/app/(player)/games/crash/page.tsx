'use client'

import React, { useState, useEffect } from 'react'
import { useCrashGame } from '@/hooks/useCrashGame'
import { BetPanel } from '@/components/game/BetPanel'
import { RoundHistory } from '@/components/game/RoundHistory'
import { LiveLeaderboard } from '@/components/game/LiveLeaderboard'
import { CrashChart } from '@/components/game/CrashChart'

export default function CrashPage() {
  const { status, multiplier, myBet, crashPoint, waitingEndsAt, recentCrashes, feed, error, placeBet, cashout } =
    useCrashGame()

  const [chartPoints, setChartPoints] = useState<number[]>([])

  useEffect(() => {
    if (status === 'waiting') {
      setChartPoints([])
    } else if (status === 'running') {
      setChartPoints(prev => [...prev, multiplier])
    }
  }, [status, multiplier])

  const multiplierColor =
    status === 'crashed' ? 'text-warning-coral' : 'text-accent-cyan'

  const multiplierLabel =
    status === 'waiting'
      ? 'WAITING...'
      : status === 'crashed'
      ? `CRASHED @ ${crashPoint?.toFixed(2)}×`
      : `${multiplier.toFixed(2)}×`

  return (
    <div className="min-h-screen bg-game-bg p-4 space-y-4">
      <h1 className="text-white text-xl font-bold">Crash</h1>

      <div
        data-testid="crash-chart"
        className="relative bg-game-card border border-game-border rounded-xl overflow-hidden h-48"
      >
        <CrashChart points={chartPoints} status={status === 'idle' ? 'waiting' : status} />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={`text-3xl font-extrabold tracking-tight drop-shadow ${multiplierColor}`}>
            {multiplierLabel}
          </span>
        </div>
      </div>

      <BetPanel
        status={status}
        myBet={myBet}
        waitingEndsAt={waitingEndsAt}
        error={error}
        onPlaceBet={placeBet}
        onCashout={cashout}
      />

      <RoundHistory crashes={recentCrashes} />

      <LiveLeaderboard feed={feed} />
    </div>
  )
}
