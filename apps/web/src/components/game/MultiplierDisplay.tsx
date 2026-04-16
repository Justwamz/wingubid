'use client'
interface Props {
  multiplier: number
  status: 'idle' | 'waiting' | 'running' | 'crashed'
  crashPoint: number | null
  waitingEndsAt: number | null
}

export function MultiplierDisplay({ multiplier, status, crashPoint }: Props) {
  const isCrashed = status === 'crashed'
  const isWaiting = status === 'waiting'

  return (
    <div className="flex flex-col items-center justify-center h-48 rounded-xl bg-game-card border border-game-border">
      {isWaiting ? (
        <div className="text-center">
          <p className="text-sm text-gray-400 mb-1">Next round starting</p>
          <p className="text-accent-cyan font-mono text-4xl font-bold">WAITING</p>
        </div>
      ) : isCrashed ? (
        <div className="text-center">
          <p className="text-warning-coral font-mono text-5xl font-bold animate-pulse">
            CRASHED
          </p>
          <p className="text-warning-coral font-mono text-2xl mt-1">@ {crashPoint?.toFixed(2)}×</p>
        </div>
      ) : (
        <p
          className="font-mono font-bold text-6xl transition-colors"
          style={{ color: multiplier >= 2 ? '#00F2FE' : '#ffffff' }}
        >
          {multiplier.toFixed(2)}×
        </p>
      )}
    </div>
  )
}
