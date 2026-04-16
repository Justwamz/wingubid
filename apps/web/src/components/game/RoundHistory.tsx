interface Props { crashes: number[] }

export function RoundHistory({ crashes }: Props) {
  return (
    <div className="flex gap-1 overflow-x-auto py-1">
      {crashes.map((c, i) => (
        <span
          key={i}
          className="shrink-0 px-2 py-0.5 rounded-full text-xs font-mono font-bold"
          style={{
            background: c < 2 ? '#FF4E50' : c < 10 ? '#80508B' : '#00F2FE',
            color: '#272422',
          }}
        >
          {c.toFixed(2)}×
        </span>
      ))}
    </div>
  )
}
