'use client'
interface Props {
  gridSize: number
  revealedTiles: number[]
  minePositions: number[] | null
  onReveal: (index: number) => void
  disabled: boolean
}

export function MinesGrid({ gridSize, revealedTiles, minePositions, onReveal, disabled }: Props) {
  const total = gridSize * gridSize

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${gridSize}, 1fr)` }}
    >
      {Array.from({ length: total }, (_, i) => {
        const isRevealed = revealedTiles.includes(i)
        const isMine = minePositions?.includes(i)

        return (
          <button
            key={i}
            onClick={() => !disabled && !isRevealed && onReveal(i)}
            disabled={disabled || isRevealed}
            className={`aspect-square rounded-xl border text-2xl font-bold transition-all duration-300 ${
              isMine
                ? 'bg-warning-coral border-warning-coral text-game-bg'
                : isRevealed
                ? 'bg-accent-cyan border-accent-cyan text-game-bg scale-95'
                : 'bg-game-card border-game-border hover:border-accent-cyan active:scale-95'
            }`}
          >
            {isMine ? '💥' : isRevealed ? '💎' : ''}
          </button>
        )
      })}
    </div>
  )
}
