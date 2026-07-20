'use client'
import { STAKE_SHORTCUTS } from '@/lib/gameConfig'

interface Props {
  onSelect: (value: number) => void
  disabled?: boolean
  activeValue?: number
}

// Shared quick-select stake row. Tapping a button SETs the stake to that amount.
export function QuickStakes({ onSelect, disabled, activeValue }: Props) {
  return (
    <div className="flex gap-2">
      {STAKE_SHORTCUTS.map(v => (
        <button
          key={v}
          onClick={() => onSelect(v)}
          disabled={disabled}
          className={`flex-1 rounded-lg py-1 text-sm border transition-colors disabled:opacity-40 ${
            activeValue === v
              ? 'border-accent-cyan text-accent-cyan bg-accent-cyan/10'
              : 'bg-game-bg border-game-border text-gray-300 hover:border-accent-cyan'
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  )
}
