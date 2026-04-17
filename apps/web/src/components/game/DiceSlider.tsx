'use client'
interface Props {
  value: number
  onChange: (value: number) => void
  // Legacy props retained for backward compat (ignored by new layout)
  target?: number
  direction?: 'over' | 'under'
  result?: number | null
}

export function DiceSlider({ value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-gray-400">
        <span>1</span>
        <span className="text-white font-semibold">{value}</span>
        <span>99</span>
      </div>
      <input
        type="range" min="1" max="99"
        value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-accent-cyan"
      />
    </div>
  )
}
