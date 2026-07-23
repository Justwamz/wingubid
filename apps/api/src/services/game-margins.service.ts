import {
  PRIZE_MULTIPLIERS as LOTTERY_PRIZES,
  LOTTERY_POOL,
  LOTTERY_PICK,
} from './lottery.service.js'
import {
  PRIZE_MULTIPLIERS as SCRATCH_PRIZES,
  CUMULATIVE_WEIGHTS,
  SYMBOLS_EMOJI,
} from './scratch.service.js'

// These games have no single "house edge" knob - their margin is structural,
// set by fixed prize tables (and match odds). We derive the effective RTP /
// house edge from the same constants the games use, so the admin read-out is
// always truthful (no drift from hardcoded numbers).

function combinations(n: number, k: number): number {
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}

export interface LotteryMargin {
  drawType: string
  prizes: { match3: number; match4: number; match5: number; match6: number }
  rtpPct: number
  edgePct: number
}

export function getLotteryMargins(): LotteryMargin[] {
  const totalCombos = combinations(LOTTERY_POOL, LOTTERY_PICK) // C(36,6) = 1,947,792
  const others = LOTTERY_POOL - LOTTERY_PICK // 30
  // Probability of matching exactly k of the LOTTERY_PICK drawn numbers.
  const pk = (k: number) =>
    (combinations(LOTTERY_PICK, k) * combinations(others, LOTTERY_PICK - k)) / totalCombos
  const p3 = pk(3), p4 = pk(4), p5 = pk(5), p6 = pk(6)

  return Object.entries(LOTTERY_PRIZES).map(([drawType, m]) => {
    const rtp = p3 * (m[3] ?? 0) + p4 * (m[4] ?? 0) + p5 * (m[5] ?? 0) + p6 * (m[6] ?? 0)
    return {
      drawType,
      prizes: { match3: m[3] ?? 0, match4: m[4] ?? 0, match5: m[5] ?? 0, match6: m[6] ?? 0 },
      rtpPct: Math.round(rtp * 10000) / 100,
      edgePct: Math.round((1 - rtp) * 10000) / 100,
    }
  })
}

export interface ScratchMargin {
  rtpPct: number
  edgePct: number
  winRatePct: number
  symbols: { emoji: string; probPct: number; match3: number; match4: number; match5: number }[]
}

// Exact RTP over the multinomial distribution of a 9-cell grid. The prize is the
// best-paying symbol present with count >= 3 (matchCount clamped to 5).
export function getScratchMargin(): ScratchMargin {
  const cells = 9
  const probs = CUMULATIVE_WEIGHTS.map((c, i) => (c - (CUMULATIVE_WEIGHTS[i - 1] ?? 0)) / 100)
  const cats = probs.length // 6 (5 paying symbols + the blank)

  const fact: number[] = [1]
  for (let i = 1; i <= cells; i++) fact[i] = fact[i - 1] * i

  let rtp = 0
  let winProb = 0

  // Enumerate every composition n0..n(cats-1) summing to `cells`.
  const counts = new Array(cats).fill(0)
  function recurse(idx: number, remaining: number) {
    if (idx === cats - 1) {
      counts[idx] = remaining
      // Multinomial probability of this composition.
      let prob = fact[cells]
      for (let i = 0; i < cats; i++) prob = (prob / fact[counts[i]]) * Math.pow(probs[i], counts[i])
      // Best qualifying prize (paying symbols are indices 0..4; last is blank).
      let best = 0
      for (let s = 0; s < cats - 1; s++) {
        const cnt = counts[s]
        if (cnt >= 3) {
          const mult = SCRATCH_PRIZES[s]?.[Math.min(cnt, 5)] ?? 0
          if (mult > best) best = mult
        }
      }
      rtp += prob * best
      if (best > 0) winProb += prob
      return
    }
    for (let n = 0; n <= remaining; n++) {
      counts[idx] = n
      recurse(idx + 1, remaining - n)
    }
  }
  recurse(0, cells)

  return {
    rtpPct: Math.round(rtp * 10000) / 100,
    edgePct: Math.round((1 - rtp) * 10000) / 100,
    winRatePct: Math.round(winProb * 10000) / 100,
    symbols: [0, 1, 2, 3, 4].map(s => ({
      emoji: SYMBOLS_EMOJI[s],
      probPct: Math.round(probs[s] * 10000) / 100,
      match3: SCRATCH_PRIZES[s]?.[3] ?? 0,
      match4: SCRATCH_PRIZES[s]?.[4] ?? 0,
      match5: SCRATCH_PRIZES[s]?.[5] ?? 0,
    })),
  }
}
