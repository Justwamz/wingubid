import type { PoolClient } from '@betting/db'
import { nextSeedRoll, getSeedCommitment, rotateSeed, type SeedRoll } from './player-seed.service.js'

// Dice uses the shared per-player provably-fair seed store (dice_seeds).
export type DiceSeedRoll = SeedRoll

export function nextDiceRoll(client: PoolClient, playerId: string): Promise<DiceSeedRoll> {
  return nextSeedRoll(client, 'dice_seeds', playerId)
}

export function getDiceCommitment(playerId: string) {
  return getSeedCommitment('dice_seeds', playerId)
}

export function rotateDiceSeed(playerId: string, newClientSeed?: string) {
  return rotateSeed('dice_seeds', playerId, newClientSeed)
}
