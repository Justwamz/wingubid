'use client'
import { useCrashGame } from '@/hooks/useCrashGame'
import { MultiplierDisplay } from '@/components/game/MultiplierDisplay'
import { BetPanel } from '@/components/game/BetPanel'
import { RoundHistory } from '@/components/game/RoundHistory'
import { LiveLeaderboard } from '@/components/game/LiveLeaderboard'

export default function CrashPage() {
  const { status, multiplier, myBet, crashPoint, waitingEndsAt, recentCrashes, feed, error, placeBet, cashout } = useCrashGame()

  return (
    <div className="min-h-screen bg-game-bg text-white flex flex-col p-4 gap-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-accent-cyan font-mono">CRASH</h1>

      <MultiplierDisplay
        multiplier={multiplier}
        status={status}
        crashPoint={crashPoint}
        waitingEndsAt={waitingEndsAt}
      />

      <BetPanel
        status={status}
        myBet={myBet}
        multiplier={multiplier}
        onPlaceBet={placeBet}
        onCashout={cashout}
      />

      {error && (
        <p className="text-warning-coral text-sm text-center">{error}</p>
      )}

      <RoundHistory crashes={recentCrashes} />

      <LiveLeaderboard feed={feed} />
    </div>
  )
}
