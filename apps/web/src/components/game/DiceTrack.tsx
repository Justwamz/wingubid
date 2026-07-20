'use client'

interface Props {
  target: number
  onChange: (value: number) => void
  direction: 'over' | 'under'
  result: number | null
  won: boolean | null
  // Live 0-100 value while the roll is spinning; drives the sweeping marker.
  rollingValue?: number | null
}

const WIN = '#00C896'
const LOSE = '#FF4E50'
const NEUTRAL = '#e5e7eb'

// The dice track IS the result surface: a green win zone and a red lose zone
// split at the target, with the rolled number dropping onto the exact spot so a
// player can see why they won or lost. Axis is 0-100; position(v) = v%.
export function DiceTrack({ target, onChange, direction, result, won, rollingValue }: Props) {
  const winRight = direction === 'over' // win zone is to the RIGHT of the target
  const betText = direction === 'over'
    ? `Roll above ${target} to win`
    : `Roll below ${target} to win`

  // Marker position + colour: while spinning, follow the live value in a neutral
  // colour; once landed, sit on the result coloured by win/loss.
  const isSpinning = rollingValue != null
  const markerValue = isSpinning ? rollingValue! : result
  const markerColor = isSpinning ? NEUTRAL : (won ? WIN : LOSE)

  return (
    <div className="space-y-3">
      {/* Track */}
      <div className="dice-track relative h-14 select-none">
        {/* Zones */}
        <div className="absolute inset-0 rounded-xl overflow-hidden flex">
          <div
            className="h-full flex items-center justify-start pl-3"
            style={{
              width: `${target}%`,
              background: winRight ? `${LOSE}26` : `${WIN}2e`,
              borderRight: `2px solid ${winRight ? LOSE : WIN}`,
            }}
          >
            <span className="text-[10px] font-mono font-bold tracking-widest"
              style={{ color: winRight ? LOSE : WIN }}>
              {winRight ? 'LOSE' : 'WIN'}
            </span>
          </div>
          <div
            className="h-full flex items-center justify-end pr-3"
            style={{
              width: `${100 - target}%`,
              background: winRight ? `${WIN}2e` : `${LOSE}26`,
            }}
          >
            <span className="text-[10px] font-mono font-bold tracking-widest"
              style={{ color: winRight ? WIN : LOSE }}>
              {winRight ? 'WIN' : 'LOSE'}
            </span>
          </div>
        </div>

        {/* Target boundary handle */}
        <div
          className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none z-10"
          style={{ left: `${target}%`, transform: 'translateX(-50%)' }}
        >
          <div className="w-0.5 flex-1 bg-white/80" />
          <span className="absolute -top-5 text-xs font-mono font-bold text-white bg-game-bg border border-game-border rounded px-1.5 py-0.5">
            {target}
          </span>
        </div>

        {/* Result / rolling marker */}
        {markerValue != null && (
          <div
            className={`${isSpinning ? 'dice-marker-spin' : 'dice-marker-land'} absolute -bottom-1 flex flex-col items-center z-20`}
            style={{ left: `${markerValue}%`, transform: 'translateX(-50%)' }}
          >
            <span
              className="text-sm font-mono font-extrabold rounded-md px-2 py-0.5 shadow-lg tabular-nums"
              style={{
                color: '#0a0a0a',
                background: markerColor,
                boxShadow: `0 0 12px ${markerColor}99`,
              }}
            >
              {markerValue}
            </span>
            <span style={{ color: markerColor, lineHeight: 1 }}>▲</span>
          </div>
        )}

        {/* Transparent range input for drag + keyboard (thumb invisible; the
            visible handle above is positioned exactly at target%). */}
        <input
          type="range"
          min={1}
          max={99}
          value={target}
          onChange={e => onChange(Number(e.target.value))}
          aria-label={`Target number, ${betText.toLowerCase()}`}
          className="dice-range absolute inset-0 w-full h-full m-0 cursor-pointer opacity-0 z-30"
        />
      </div>

      {/* Axis ends */}
      <div className="flex justify-between text-xs text-gray-500 font-mono">
        <span>0</span>
        <span>100</span>
      </div>
    </div>
  )
}
