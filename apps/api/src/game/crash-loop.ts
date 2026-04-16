import { randomBytes, createHash } from 'crypto'
import type { Server } from 'socket.io'
import { getRedis } from '../lib/redis.js'
import { pool } from '@betting/db'
import { generateCrashPoint } from '../lib/crash-rng.js'
import { settleLostBets, getHouseEdge, cashout } from '../services/crash.service.js'

const ROUND_KEY = 'crash:round:current'
const WAITING_MS = 5000
const POST_CRASH_MS = 2000

export interface CrashRoundState {
  roundId: string
  roundNumber: number
  status: 'waiting' | 'running' | 'crashed'
  serverSeed: string
  serverSeedHash: string
  clientSeed: string
  crashPoint: number
  multiplier: number
  waitingEndsAt: number
  startedAt: number
  bets: Record<string, { betId: string; effectiveStake: number; autoCashoutAt?: number }>
}

let currentRound: CrashRoundState | null = null
let tickRunning = false
let intervalId: ReturnType<typeof setInterval> | null = null

export function startCrashLoop(io: Server): void {
  intervalId = setInterval(() => {
    tick(io).catch(err => console.error('[crash-loop] tick error', err))
  }, 100)
}

export function stopCrashLoop(): void {
  if (intervalId) clearInterval(intervalId)
  intervalId = null
  currentRound = null
}

export function addBetToRound(
  playerId: string,
  betId: string,
  effectiveStake: number,
  autoCashoutAt?: number,
): void {
  if (!currentRound || currentRound.status !== 'waiting') return
  currentRound.bets[playerId] = { betId, effectiveStake, autoCashoutAt }
  getRedis().set(ROUND_KEY, JSON.stringify(currentRound))
}

export function removeBetFromRound(playerId: string): void {
  if (!currentRound) return
  delete currentRound.bets[playerId]
}

export function getCurrentRound(): CrashRoundState | null {
  return currentRound
}

async function tick(io: Server): Promise<void> {
  if (tickRunning) return
  tickRunning = true
  try {
    if (!currentRound) {
      await initRound()
      return
    }

    const now = Date.now()

    if (currentRound.status === 'waiting') {
      if (now >= currentRound.waitingEndsAt) {
        await transitionToRunning(io)
      }
      return
    }

    if (currentRound.status === 'running') {
      const elapsedSec = (now - currentRound.startedAt) / 1000
      const multiplier = Math.max(1.00, Math.floor(Math.exp(elapsedSec * 0.1) * 100) / 100)
      currentRound.multiplier = multiplier

      for (const [playerId, bet] of Object.entries(currentRound.bets)) {
        if (bet.autoCashoutAt && multiplier >= bet.autoCashoutAt) {
          try {
            const { winnings } = await cashout(playerId, bet.betId, multiplier)
            removeBetFromRound(playerId)
            io.to('crash').emit('cashout:broadcast', { playerId, multiplier, winnings })
          } catch (err) {
            console.error('[crash-loop] auto-cashout failed', err)
          }
        }
      }

      io.to('crash').emit('round:tick', { multiplier })

      if (multiplier >= currentRound.crashPoint) {
        await transitionToCrashed(io)
      }
    }
  } finally {
    tickRunning = false
  }
}

async function initRound(): Promise<void> {
  const redis = getRedis()
  const existing = await redis.get(ROUND_KEY)
  if (existing) {
    const state = JSON.parse(existing) as CrashRoundState
    if (state.status === 'running') {
      await settleLostBets(state.roundId, state.serverSeed, state.crashPoint)
      await redis.del(ROUND_KEY)
    } else if (state.status === 'waiting') {
      currentRound = state
      return
    }
  }
  await createNewRound()
}

async function createNewRound(): Promise<void> {
  const serverSeed = randomBytes(32).toString('hex')
  const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex')
  const clientSeed = randomBytes(16).toString('hex')
  const houseEdge = await getHouseEdge('crash_house_edge')

  const { rows } = await pool.query<{ id: string; round_number: string }>(
    `INSERT INTO game_rounds (server_seed_hash, client_seed, status)
     VALUES ($1, $2, 'waiting') RETURNING id, round_number`,
    [serverSeedHash, clientSeed],
  )

  const roundId = rows[0].id
  const roundNumber = Number(rows[0].round_number)
  const crashPoint = generateCrashPoint(serverSeed, clientSeed, roundNumber, houseEdge)

  currentRound = {
    roundId, roundNumber, status: 'waiting',
    serverSeed, serverSeedHash, clientSeed, crashPoint,
    multiplier: 1.00, waitingEndsAt: Date.now() + WAITING_MS, startedAt: 0, bets: {},
  }
  await getRedis().set(ROUND_KEY, JSON.stringify(currentRound))
}

async function transitionToRunning(io: Server): Promise<void> {
  if (!currentRound) return
  currentRound.status = 'running'
  currentRound.startedAt = Date.now()
  await pool.query(
    `UPDATE game_rounds SET status = 'running', started_at = NOW() WHERE id = $1`,
    [currentRound.roundId],
  )
  await getRedis().set(ROUND_KEY, JSON.stringify(currentRound))
  io.to('crash').emit('round:started', {
    roundId: currentRound.roundId,
    roundNumber: currentRound.roundNumber,
    serverSeedHash: currentRound.serverSeedHash,
    clientSeed: currentRound.clientSeed,
  })
}

async function transitionToCrashed(io: Server): Promise<void> {
  if (!currentRound) return
  const { roundId, serverSeed, crashPoint } = currentRound
  currentRound.status = 'crashed'
  await settleLostBets(roundId, serverSeed, crashPoint)
  await getRedis().del(ROUND_KEY)
  io.to('crash').emit('round:crashed', { crashPoint, serverSeed, roundId })
  currentRound = null
  setTimeout(() => createNewRound(), POST_CRASH_MS)
}
