# Phase 3c UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update color tokens and add visual components (CrashChart, DiceFace, MinesHistory) to match the approved design mockup.

**Architecture:** Swap two Tailwind color tokens so `game-bg` becomes dark violet (#1a1025) and `game-card` becomes charcoal (#272422), then add three new visual components and wire them into the existing Crash, Dice, and Mines game pages.

**Tech Stack:** Next.js 14, React 18, TypeScript 5, Tailwind CSS, SVG (inline JSX)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `apps/web/tailwind.config.ts` | Update `game-bg` and `game-card` color values |
| Create | `apps/web/src/components/game/CrashChart.tsx` | SVG curve chart for Crash game |
| Modify | `apps/web/src/app/(player)/games/crash/page.tsx` | Integrate CrashChart, accumulate chart points |
| Create | `apps/web/src/components/game/DiceFace.tsx` | SVG dice face with pips |
| Modify | `apps/web/src/app/(player)/games/dice/page.tsx` | Show DiceFace results, HIGH/LOW pill buttons |
| Create | `apps/web/src/components/game/MinesHistory.tsx` | Recent mines game history table |
| Modify | `apps/web/src/app/(player)/games/mines/page.tsx` | Add MinesHistory below grid |

---

### Task 1: Update Color Tokens

**Files:**
- Modify: `apps/web/tailwind.config.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/game/__tests__/color-tokens.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import resolveConfig from 'tailwindcss/resolveConfig'
import tailwindConfig from '../../../../tailwind.config'

const config = resolveConfig(tailwindConfig as Parameters<typeof resolveConfig>[0])

describe('color tokens', () => {
  it('game-bg is dark violet', () => {
    expect((config.theme.colors as Record<string, string>)['game-bg']).toBe('#1a1025')
  })
  it('game-card is charcoal', () => {
    expect((config.theme.colors as Record<string, string>)['game-card']).toBe('#272422')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @betting/web test -- color-tokens`
Expected: FAIL — `game-bg` expected `#1a1025` received `#272422`

- [ ] **Step 3: Update color tokens**

Open `apps/web/tailwind.config.ts` and change:

```typescript
// Before
'game-bg':       '#272422',
'game-card':     '#1e1b18',

// After
'game-bg':       '#1a1025',
'game-card':     '#272422',
```

Full colors block after change:
```typescript
colors: {
  'game-bg':       '#1a1025',
  'game-card':     '#272422',
  'game-border':   '#3a3530',
  'accent-cyan':   '#00F2FE',
  'accent-violet': '#80508B',
  'warning-coral': '#FF4E50',
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @betting/web test -- color-tokens`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/tailwind.config.ts apps/web/src/components/game/__tests__/color-tokens.test.ts
git commit -m "feat(ui): update game-bg to dark violet, game-card to charcoal"
```

---

### Task 2: CrashChart SVG Component

**Files:**
- Create: `apps/web/src/components/game/CrashChart.tsx`
- Create: `apps/web/src/components/game/__tests__/CrashChart.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/game/__tests__/CrashChart.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CrashChart } from '../CrashChart'

describe('CrashChart', () => {
  it('renders an SVG', () => {
    const { container } = render(<CrashChart points={[1, 1.5, 2, 2.8]} status="running" />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders polyline when points provided', () => {
    const { container } = render(<CrashChart points={[1, 1.5, 2]} status="running" />)
    expect(container.querySelector('polyline')).toBeTruthy()
  })

  it('shows no polyline when no points', () => {
    const { container } = render(<CrashChart points={[]} status="waiting" />)
    expect(container.querySelector('polyline')).toBeNull()
  })

  it('applies cyan stroke when running', () => {
    const { container } = render(<CrashChart points={[1, 2]} status="running" />)
    const polyline = container.querySelector('polyline')
    expect(polyline?.getAttribute('stroke')).toBe('#00F2FE')
  })

  it('applies coral stroke when crashed', () => {
    const { container } = render(<CrashChart points={[1, 2, 1.5]} status="crashed" />)
    const polyline = container.querySelector('polyline')
    expect(polyline?.getAttribute('stroke')).toBe('#FF4E50')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @betting/web test -- CrashChart`
Expected: FAIL — `Cannot find module '../CrashChart'`

- [ ] **Step 3: Create the component**

Create `apps/web/src/components/game/CrashChart.tsx`:

```typescript
'use client'

interface CrashChartProps {
  points: number[]   // multiplier values over time, e.g. [1.00, 1.05, 1.12, ...]
  status: 'waiting' | 'running' | 'crashed'
}

const W = 300
const H = 160
const PAD = 16

// Map a multiplier value to SVG y coordinate (higher multiplier = lower y)
function toY(value: number, maxValue: number): number {
  const range = Math.max(maxValue - 1, 1)
  return H - PAD - ((value - 1) / range) * (H - PAD * 2)
}

// Map an index to SVG x coordinate
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

  // Closed polygon for gradient fill: trace curve then close along bottom
  const fillPoints =
    points.length > 1
      ? [
          ...points.map((v, i) => `${toX(i, points.length)},${toY(v, maxValue)}`),
          `${toX(points.length - 1, points.length)},${H - PAD}`,
          `${PAD},${H - PAD}`,
        ].join(' ')
      : ''

  // Grid lines at 1×, 2×, 3×, 5×
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

      {/* Grid lines */}
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

      {/* Fill polygon */}
      {fillPoints && (
        <polygon points={fillPoints} fill={`url(#${fillId})`} />
      )}

      {/* Curve */}
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

      {/* End dot */}
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @betting/web test -- CrashChart`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/game/CrashChart.tsx apps/web/src/components/game/__tests__/CrashChart.test.tsx
git commit -m "feat(ui): add CrashChart SVG component"
```

---

### Task 3: Integrate CrashChart into Crash Page

**Files:**
- Modify: `apps/web/src/app/(player)/games/crash/page.tsx`

- [ ] **Step 1: Read the current crash page**

Run: open `apps/web/src/app/(player)/games/crash/page.tsx` and note the imports and JSX structure.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/app/(player)/games/crash/__tests__/page.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

// Mock the hook so tests don't need WebSocket
vi.mock('@/hooks/useCrashGame', () => ({
  useCrashGame: () => ({
    status: 'waiting',
    multiplier: 1,
    myBet: null,
    crashPoint: null,
    waitingEndsAt: null,
    recentCrashes: [],
    feed: [],
    error: null,
    placeBet: vi.fn(),
    cashout: vi.fn(),
  }),
}))

vi.mock('@/lib/apiFetch', () => ({ apiFetch: vi.fn() }))

import CrashPage from '../page'

describe('CrashPage', () => {
  it('renders without crashing', () => {
    const { container } = render(<CrashPage />)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders the chart container', () => {
    const { container } = render(<CrashPage />)
    expect(container.querySelector('[data-testid="crash-chart"]')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @betting/web test -- crash/page`
Expected: FAIL — no element with `data-testid="crash-chart"`

- [ ] **Step 4: Update crash page**

Replace the content of `apps/web/src/app/(player)/games/crash/page.tsx` with:

```typescript
'use client'

import { useState, useEffect } from 'react'
import { useCrashGame } from '@/hooks/useCrashGame'
import { BetPanel } from '@/components/game/BetPanel'
import { RoundHistory } from '@/components/game/RoundHistory'
import { LiveLeaderboard } from '@/components/game/LiveLeaderboard'
import { CrashChart } from '@/components/game/CrashChart'

export default function CrashPage() {
  const { status, multiplier, myBet, crashPoint, waitingEndsAt, recentCrashes, feed, error, placeBet, cashout } =
    useCrashGame()

  const [chartPoints, setChartPoints] = useState<number[]>([])

  useEffect(() => {
    if (status === 'waiting') {
      setChartPoints([])
    } else if (status === 'running') {
      setChartPoints(prev => [...prev, multiplier])
    }
  }, [status, multiplier])

  const multiplierColor =
    status === 'crashed' ? 'text-warning-coral' : 'text-accent-cyan'

  const multiplierLabel =
    status === 'waiting'
      ? 'WAITING...'
      : status === 'crashed'
      ? `CRASHED @ ${crashPoint?.toFixed(2)}×`
      : `${multiplier.toFixed(2)}×`

  return (
    <div className="min-h-screen bg-game-bg p-4 space-y-4">
      <h1 className="text-white text-xl font-bold">Crash</h1>

      {/* Chart */}
      <div
        data-testid="crash-chart"
        className="relative bg-game-card border border-game-border rounded-xl overflow-hidden h-48"
      >
        <CrashChart points={chartPoints} status={status} />
        {/* Multiplier overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={`text-3xl font-extrabold tracking-tight drop-shadow ${multiplierColor}`}>
            {multiplierLabel}
          </span>
        </div>
      </div>

      <BetPanel
        status={status}
        myBet={myBet}
        waitingEndsAt={waitingEndsAt}
        error={error}
        onPlaceBet={placeBet}
        onCashout={cashout}
      />

      <RoundHistory crashes={recentCrashes} />

      <LiveLeaderboard feed={feed} />
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @betting/web test -- crash/page`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/(player)/games/crash/page.tsx apps/web/src/app/(player)/games/crash/__tests__/page.test.tsx
git commit -m "feat(ui): integrate CrashChart into crash game page"
```

---

### Task 4: DiceFace SVG Component + Dice Page Redesign

**Files:**
- Create: `apps/web/src/components/game/DiceFace.tsx`
- Create: `apps/web/src/components/game/__tests__/DiceFace.test.tsx`
- Modify: `apps/web/src/app/(player)/games/dice/page.tsx`

- [ ] **Step 1: Write the failing test for DiceFace**

Create `apps/web/src/components/game/__tests__/DiceFace.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DiceFace } from '../DiceFace'

describe('DiceFace', () => {
  it('renders SVG', () => {
    const { container } = render(<DiceFace value={3} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders correct pip count for value 1', () => {
    const { container } = render(<DiceFace value={1} />)
    expect(container.querySelectorAll('circle').length).toBe(1)
  })

  it('renders correct pip count for value 6', () => {
    const { container } = render(<DiceFace value={6} />)
    expect(container.querySelectorAll('circle').length).toBe(6)
  })

  it('applies won color when won prop is true', () => {
    const { container } = render(<DiceFace value={4} won />)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#1a1025')
    const circles = container.querySelectorAll('circle')
    expect(circles[0]?.getAttribute('fill')).toBe('#00F2FE')
  })

  it('applies default color when not won', () => {
    const { container } = render(<DiceFace value={4} />)
    const circles = container.querySelectorAll('circle')
    expect(circles[0]?.getAttribute('fill')).toBe('#80508B')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @betting/web test -- DiceFace`
Expected: FAIL — `Cannot find module '../DiceFace'`

- [ ] **Step 3: Create DiceFace component**

Create `apps/web/src/components/game/DiceFace.tsx`:

```typescript
interface DiceFaceProps {
  value: 1 | 2 | 3 | 4 | 5 | 6
  size?: number
  won?: boolean
}

// Standard pip positions for each face value
// Each pip is [cx, cy] in a 0-1 coordinate space
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
  const r = size * 0.1   // pip radius

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
```

- [ ] **Step 4: Run DiceFace tests to verify they pass**

Run: `pnpm --filter @betting/web test -- DiceFace`
Expected: PASS (5 tests)

- [ ] **Step 5: Update dice page**

Replace `apps/web/src/app/(player)/games/dice/page.tsx` with:

```typescript
'use client'

import { useState } from 'react'
import { DiceSlider } from '@/components/game/DiceSlider'
import { DiceFace } from '@/components/game/DiceFace'
import { apiFetch } from '@/lib/apiFetch'

type Direction = 'over' | 'under'

interface RollResult {
  roll: number
  won: boolean
  winnings: number
  newBalance: number
}

// Returns a 1-6 face value from a 0-100 roll
function rollToFace(roll: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return (Math.ceil((roll / 100) * 6) || 1) as 1 | 2 | 3 | 4 | 5 | 6
}

export default function DicePage() {
  const [target, setTarget] = useState(50)
  const [direction, setDirection] = useState<Direction>('over')
  const [grossStake, setGrossStake] = useState('')
  const [result, setResult] = useState<RollResult | null>(null)
  const [rolling, setRolling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<RollResult[]>([])

  const winChance = direction === 'over' ? 100 - target : target
  const multiplier = winChance > 0 ? parseFloat((99 / winChance).toFixed(4)) : 0

  async function handleRoll() {
    const stake = parseFloat(grossStake)
    if (!stake || stake <= 0) return
    setRolling(true)
    setError(null)
    try {
      const data = await apiFetch<RollResult>('/games/dice/roll', {
        method: 'POST',
        body: JSON.stringify({ grossStake: stake, target, direction }),
      })
      setResult(data)
      setHistory(prev => [data, ...prev].slice(0, 10))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Roll failed')
    } finally {
      setRolling(false)
    }
  }

  const faceValue = result ? rollToFace(result.roll) : 1

  return (
    <div className="min-h-screen bg-game-bg p-4 space-y-4">
      <h1 className="text-white text-xl font-bold">Dice</h1>

      {/* Result display */}
      <div className="bg-game-card border border-game-border rounded-xl p-6 flex flex-col items-center gap-3">
        <div className="flex gap-4 items-center">
          <DiceFace value={faceValue} size={80} won={result?.won ?? false} />
          {result && (
            <div className="text-center">
              <p className="text-3xl font-extrabold text-white">{result.roll}</p>
              <p className={`text-sm font-semibold ${result.won ? 'text-accent-cyan' : 'text-warning-coral'}`}>
                {result.won ? `+${result.winnings} WON` : 'LOST'}
              </p>
            </div>
          )}
        </div>

        {/* Direction toggle */}
        <div className="flex gap-2">
          {(['over', 'under'] as Direction[]).map(d => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              className={`px-5 py-2 rounded-full text-sm font-bold transition-colors ${
                direction === d
                  ? 'bg-accent-violet text-white'
                  : 'bg-game-bg text-gray-400 border border-game-border'
              }`}
            >
              {d === 'over' ? 'HIGH' : 'LOW'}
            </button>
          ))}
        </div>

        {/* Stats row */}
        <div className="flex gap-6 text-center text-xs text-gray-400">
          <div><p className="text-white font-semibold">{target}</p><p>Target</p></div>
          <div><p className="text-white font-semibold">{winChance}%</p><p>Win Chance</p></div>
          <div><p className="text-white font-semibold">{multiplier}×</p><p>Multiplier</p></div>
        </div>
      </div>

      {/* Slider */}
      <div className="bg-game-card border border-game-border rounded-xl p-4">
        <DiceSlider value={target} onChange={setTarget} />
      </div>

      {/* Bet controls */}
      <div className="bg-game-card border border-game-border rounded-xl p-4 space-y-3">
        <input
          type="number"
          placeholder="Stake amount"
          value={grossStake}
          onChange={e => setGrossStake(e.target.value)}
          className="w-full bg-game-bg border border-game-border rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-accent-cyan"
        />
        {error && <p className="text-warning-coral text-sm">{error}</p>}
        <button
          onClick={handleRoll}
          disabled={rolling || !grossStake}
          className="w-full py-3 rounded-xl bg-accent-violet text-white font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {rolling ? 'ROLLING...' : 'ROLL DICE'}
        </button>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="bg-game-card border border-game-border rounded-xl p-4 space-y-2">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Recent Rolls</p>
          <div className="flex flex-wrap gap-2">
            {history.map((r, i) => (
              <span
                key={i}
                className={`text-xs font-bold px-2 py-1 rounded ${
                  r.won ? 'bg-accent-cyan/10 text-accent-cyan' : 'bg-warning-coral/10 text-warning-coral'
                }`}
              >
                {r.roll}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/game/DiceFace.tsx \
        apps/web/src/components/game/__tests__/DiceFace.test.tsx \
        apps/web/src/app/(player)/games/dice/page.tsx
git commit -m "feat(ui): add DiceFace SVG, redesign dice page with HIGH/LOW buttons"
```

---

### Task 5: MinesHistory Component + Mines Page Update

**Files:**
- Create: `apps/web/src/components/game/MinesHistory.tsx`
- Create: `apps/web/src/components/game/__tests__/MinesHistory.test.tsx`
- Modify: `apps/web/src/app/(player)/games/mines/page.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/game/__tests__/MinesHistory.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MinesHistory } from '../MinesHistory'

const mockFetch = vi.fn()
vi.mock('@/lib/apiFetch', () => ({ apiFetch: (...args: unknown[]) => mockFetch(...args) }))

describe('MinesHistory', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('shows empty state when no history', async () => {
    mockFetch.mockResolvedValue([])
    render(<MinesHistory />)
    await waitFor(() => {
      expect(screen.getByText(/no mines games yet/i)).toBeTruthy()
    })
  })

  it('renders rows for mines games', async () => {
    mockFetch.mockResolvedValue([
      {
        id: '1',
        gameType: 'mines',
        status: 'won',
        grossStake: 100,
        cashoutMultiplier: 2.5,
        winnings: 250,
        settledAt: '2026-04-16T10:00:00Z',
      },
    ])
    render(<MinesHistory />)
    await waitFor(() => {
      expect(screen.getByText('100')).toBeTruthy()
      expect(screen.getByText('2.50×')).toBeTruthy()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @betting/web test -- MinesHistory`
Expected: FAIL — `Cannot find module '../MinesHistory'`

- [ ] **Step 3: Create MinesHistory component**

Create `apps/web/src/components/game/MinesHistory.tsx`:

```typescript
'use client'

import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/apiFetch'

interface BetRecord {
  id: string
  gameType: string
  status: 'won' | 'lost' | 'pending'
  grossStake: number
  cashoutMultiplier: number | null
  winnings: number | null
  settledAt: string | null
}

export function MinesHistory() {
  const [records, setRecords] = useState<BetRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch<BetRecord[]>('/player/bets')
      .then(all => setRecords(all.filter(b => b.gameType === 'mines').slice(0, 5)))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="bg-game-card border border-game-border rounded-xl p-4">
        <p className="text-gray-500 text-sm text-center">Loading history...</p>
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="bg-game-card border border-game-border rounded-xl p-4">
        <p className="text-gray-500 text-sm text-center">No mines games yet.</p>
      </div>
    )
  }

  return (
    <div className="bg-game-card border border-game-border rounded-xl p-4 space-y-2">
      <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Recent Games</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 text-xs">
            <th className="text-left py-1">Result</th>
            <th className="text-right py-1">Stake</th>
            <th className="text-right py-1">Multiplier</th>
            <th className="text-right py-1">Winnings</th>
          </tr>
        </thead>
        <tbody>
          {records.map(r => (
            <tr key={r.id} className="border-t border-game-border">
              <td className="py-1.5">
                {r.status === 'won' ? (
                  <span className="text-accent-cyan font-bold">WIN</span>
                ) : (
                  <span className="text-warning-coral font-bold">LOSS</span>
                )}
              </td>
              <td className="text-right text-white">{r.grossStake}</td>
              <td className="text-right text-gray-300">
                {r.cashoutMultiplier != null ? `${r.cashoutMultiplier.toFixed(2)}×` : '—'}
              </td>
              <td className={`text-right font-semibold ${r.status === 'won' ? 'text-accent-cyan' : 'text-warning-coral'}`}>
                {r.winnings != null ? r.winnings : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @betting/web test -- MinesHistory`
Expected: PASS (2 tests)

- [ ] **Step 5: Update mines page**

Read `apps/web/src/app/(player)/games/mines/page.tsx`, then add `<MinesHistory />` after the game-over / grid section. The import and placement:

At the top of the file, add:
```typescript
import { MinesHistory } from '@/components/game/MinesHistory'
```

After the closing `</div>` of the grid/game-over block (before the final `</div>` of the page), add:
```tsx
<MinesHistory />
```

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Expected: All tests pass (no regressions)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/game/MinesHistory.tsx \
        apps/web/src/components/game/__tests__/MinesHistory.test.tsx \
        apps/web/src/app/(player)/games/mines/page.tsx
git commit -m "feat(ui): add MinesHistory table, wire into mines page"
```

---

## Self-Review

**Spec coverage:**
- Color tokens updated ✅ (Task 1)
- CrashChart SVG component ✅ (Task 2)
- CrashChart wired to crash page with point accumulation ✅ (Task 3)
- DiceFace SVG component ✅ (Task 4)
- Dice page with HIGH/LOW pills and DiceFace ✅ (Task 4)
- MinesHistory component ✅ (Task 5)
- MinesHistory added to mines page ✅ (Task 5)

**Type consistency:**
- `CrashChart` props: `points: number[]`, `status: 'waiting' | 'running' | 'crashed'` — consistent in Task 2 and Task 3
- `DiceFace` props: `value: 1|2|3|4|5|6`, `size?: number`, `won?: boolean` — consistent in Task 4 definition and usage
- `MinesHistory` fetches from `/player/bets`, filters `gameType === 'mines'` — consistent in Task 5 definition and test mock
- `rollToFace` helper converts 0-100 roll to 1-6 face value — defined and used in same file (Task 4)

**No placeholders:** All steps have complete code. No TBD or TODO entries.
