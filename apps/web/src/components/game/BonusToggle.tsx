'use client'

interface Props {
  bonusBalance: number  // cents
  value: 'cash' | 'bonus'
  onChange: (v: 'cash' | 'bonus') => void
  disabled?: boolean
}

// Shown only when the player holds a bonus. Bonus and cash cannot be mixed in a
// single bet, so this is a hard switch of the funding source.
export function BonusToggle({ bonusBalance, value, onChange, disabled }: Props) {
  if (bonusBalance <= 0) return null
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-500">Pay with:</span>
      <div className="inline-flex rounded-lg overflow-hidden border border-game-border">
        {(['cash', 'bonus'] as const).map(v => (
          <button key={v} type="button" disabled={disabled} onClick={() => onChange(v)}
            className={`px-3 py-1 transition-colors ${value === v ? 'bg-accent-cyan text-game-bg font-semibold' : 'bg-game-bg text-gray-400'}`}>
            {v === 'cash' ? 'Cash' : `Bonus (KES ${(bonusBalance / 100).toLocaleString('en-KE')})`}
          </button>
        ))}
      </div>
    </div>
  )
}
