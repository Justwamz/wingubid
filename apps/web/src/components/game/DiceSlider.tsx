'use client'
interface Props {
  target: number
  direction: 'over' | 'under'
  onChange: (target: number) => void
  result: number | null
}

export function DiceSlider({ target, direction, onChange, result }: Props) {
  const winZoneLeft = direction === 'under' ? 0 : target
  const winZoneWidth = direction === 'under' ? target : 100 - target

  return (
    <div className="space-y-2">
      <div className="relative h-8 rounded-full overflow-hidden bg-game-bg border border-game-border">
        <div
          className="absolute inset-y-0 bg-warning-coral opacity-60"
          style={{ left: 0, width: `${direction === 'under' ? 100 - target : target}%` }}
        />
        <div
          className="absolute inset-y-0 bg-accent-cyan opacity-60"
          style={{ left: `${winZoneLeft}%`, width: `${winZoneWidth}%` }}
        />
        {result !== null && (
          <div
            className="absolute inset-y-0 w-1 bg-white"
            style={{ left: `${result}%` }}
          />
        )}
      </div>

      <input
        type="range" min="1" max="98"
        value={target} onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-accent-cyan"
      />
    </div>
  )
}
