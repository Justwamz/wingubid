import type { PoolClient } from '@betting/db'
import { nextSeedRoll, getSeedCommitment, rotateSeed, type SeedRoll } from './player-seed.service.js'

// Scratch uses the shared per-player provably-fair seed store (scratch_seeds).
export type ScratchSeedRoll = SeedRoll

export function nextScratchRoll(client: PoolClient, playerId: string): Promise<ScratchSeedRoll> {
  return nextSeedRoll(client, 'scratch_seeds', playerId)
}

export function getScratchCommitment(playerId: string) {
  return getSeedCommitment('scratch_seeds', playerId)
}

export function rotateScratchSeed(playerId: string, newClientSeed?: string) {
  return rotateSeed('scratch_seeds', playerId, newClientSeed)
}
