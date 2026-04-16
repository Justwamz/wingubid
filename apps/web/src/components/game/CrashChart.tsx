'use client'

import React from 'react'

interface CrashChartProps {
  points: number[]
  status: 'waiting' | 'running' | 'crashed'
}

const W = 300
const H = 160
const PAD = 16

function toY(value: number, maxValue: number): number {
  const range = Math.max(maxValue - 1, 1)
  return H - PAD - ((value - 1) / range) * (H - PAD * 2)
}

function toX(index: number, total: number): number {
  if (total <= 1) return PAD
  return PAD + (index / (total - 1)) * (W - PAD * 2)
}

export function CrashChart({ points, status }: CrashChartProps) {
  const maxValue = points.length > 0 ? Math.max(...points, 2) : 2
  const stroke = status === 'crashed' ? '#FF4E50' : '#00F2FE'
  const fillId = `chart-fill-${status}`

  const polyPoints = points
    .map((v, i) => `${toX(i, points.length)},${toY(v, maxValue)}`)
    .join(' ')

  const fillPoints =
    points.length > 1
      ? [
          ...points.map((v, i) => `${toX(i, points.length)},${toY(v, maxValue)}`),
          `${toX(points.length - 1, points.length)},${H - PAD}`,
          `${PAD},${H - PAD}`,
        ].join(' ')
      : ''

  const gridLines = [1, 2, 3, 5].filter(v => v <= maxValue + 0.5)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      aria-label="crash multiplier chart"
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {gridLines.map(v => {
        const y = toY(v, maxValue)
        return (
          <g key={v}>
            <line
              x1={PAD} y1={y} x2={W - PAD} y2={y}
              stroke="#3a3530" strokeWidth="1" strokeDasharray="4 4"
            />
            <text x={PAD + 2} y={y - 3} fill="#6b6560" fontSize="9">
              {v}×
            </text>
          </g>
        )
      })}

      {fillPoints && (
        <polygon points={fillPoints} fill={`url(#${fillId})`} />
      )}

      {points.length > 1 && (
        <polyline
          points={polyPoints}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {points.length > 0 && (
        <circle
          cx={toX(points.length - 1, points.length)}
          cy={toY(points[points.length - 1], maxValue)}
          r="4"
          fill={stroke}
        />
      )}
    </svg>
  )
}
