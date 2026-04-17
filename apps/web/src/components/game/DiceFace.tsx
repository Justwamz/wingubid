interface DiceFaceProps {
  value: 1 | 2 | 3 | 4 | 5 | 6
  size?: number
  won?: boolean
}

const PIP_POSITIONS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]],
}

export function DiceFace({ value, size = 64, won = false }: DiceFaceProps) {
  const pips = PIP_POSITIONS[value] ?? []
  const pipColor = won ? '#00F2FE' : '#80508B'
  const borderColor = won ? '#00F2FE' : '#3a3530'
  const r = size * 0.1

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-label={`dice showing ${value}`}
    >
      <rect
        x="2" y="2" width="60" height="60" rx="10" ry="10"
        fill="#1a1025"
        stroke={borderColor}
        strokeWidth="2"
      />
      {pips.map(([cx, cy], i) => (
        <circle
          key={i}
          cx={cx * 64}
          cy={cy * 64}
          r={r}
          fill={pipColor}
        />
      ))}
    </svg>
  )
}
