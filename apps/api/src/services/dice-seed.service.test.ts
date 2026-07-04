import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))

import { pool } from '@betting/db'
import { nextDiceRoll, rotateDiceSeed } from './dice-seed.service.js'

const mockConnect = vi.mocked(pool.connect)

beforeEach(() => vi.clearAllMocks())

describe('nextDiceRoll', () => {
  it('claims the nonce from the RETURNING row and commits a hash that matches the seed', async () => {
    let captured: unknown[] = []
    const client = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => {
        if (params) captured = params
        // Emulate the ON CONFLICT increment returning nonce 5
        return {
          rows: [{
            server_seed: params![1], server_seed_hash: params![2],
            client_seed: params![3], nonce: '5',
          }],
        }
      }),
    }
    mockConnect.mockResolvedValue(client as any)

    const roll = await nextDiceRoll(client as any, 'p-1')

    expect(roll.nonce).toBe(5)
    // Commitment integrity: the hash we persist is sha256 of the server seed,
    // so a player can later verify a revealed seed against the published hash.
    const serverSeed = captured[1] as string
    const serverSeedHash = captured[2] as string
    expect(createHash('sha256').update(serverSeed).digest('hex')).toBe(serverSeedHash)
  })
})

describe('rotateDiceSeed', () => {
  it('reveals the retired seed and commits a fresh valid one', async () => {
    const oldSeed = 'old-server-seed'
    const oldHash = createHash('sha256').update(oldSeed).digest('hex')
    let updateParams: unknown[] = []
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT')) {
          return { rows: [{ server_seed: oldSeed, server_seed_hash: oldHash, nonce: '9' }] }
        }
        if (sql.startsWith('UPDATE')) { updateParams = params! }
        return { rows: [] }
      }),
      release: vi.fn(),
    }
    mockConnect.mockResolvedValue(client as any)

    const res = await rotateDiceSeed('p-1', 'my-client-seed')

    expect(res.revealedServerSeed).toBe(oldSeed)
    expect(res.revealedNonce).toBe(9)
    expect(res.newClientSeed).toBe('my-client-seed')
    // The freshly committed hash matches its (secret) server seed.
    const newServerSeed = updateParams[1] as string
    expect(createHash('sha256').update(newServerSeed).digest('hex')).toBe(res.newServerSeedHash)
  })
})
