import { randomBytes, createHash } from 'crypto'
import type { PoolClient } from '@betting/db'
import { pool } from '@betting/db'

// Generic per-player provably-fair seed store shared by dice and scratch.
// `table` is a fixed union of our own table names (never user input), so
// interpolating it into the SQL is safe.
export type SeedTable = 'dice_seeds' | 'scratch_seeds'

export interface SeedRoll {
  serverSeed: string
  serverSeedHash: string
  clientSeed: string
  nonce: number
}

export function newServerSeed(): { serverSeed: string; serverSeedHash: string } {
  const serverSeed = randomBytes(32).toString('hex')
  const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex')
  return { serverSeed, serverSeedHash }
}

/**
 * Atomically claim the next nonce for a player's active seed, creating the seed
 * on first use. INSERT ... ON CONFLICT DO UPDATE runs as one statement, so
 * concurrent plays can never read the same nonce.
 */
export async function nextSeedRoll(
  client: PoolClient,
  table: SeedTable,
  playerId: string,
): Promise<SeedRoll> {
  const { serverSeed, serverSeedHash } = newServerSeed()
  const clientSeed = randomBytes(16).toString('hex')

  const { rows } = await client.query<{
    server_seed: string; server_seed_hash: string; client_seed: string; nonce: string
  }>(
    `INSERT INTO ${table} (player_id, server_seed, server_seed_hash, client_seed, nonce)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (player_id) DO UPDATE SET nonce = ${table}.nonce + 1
     RETURNING server_seed, server_seed_hash, client_seed, nonce`,
    [playerId, serverSeed, serverSeedHash, clientSeed],
  )
  const row = rows[0]
  return {
    serverSeed: row.server_seed,
    serverSeedHash: row.server_seed_hash,
    clientSeed: row.client_seed,
    nonce: Number(row.nonce),
  }
}

/** Current commitment (never exposes the raw server seed). */
export async function getSeedCommitment(table: SeedTable, playerId: string): Promise<{
  serverSeedHash: string; clientSeed: string; nonce: number
}> {
  const { rows } = await pool.query<{ server_seed_hash: string; client_seed: string; nonce: string }>(
    `SELECT server_seed_hash, client_seed, nonce FROM ${table} WHERE player_id = $1`,
    [playerId],
  )
  if (rows.length === 0) {
    const { serverSeed, serverSeedHash } = newServerSeed()
    const clientSeed = randomBytes(16).toString('hex')
    await pool.query(
      `INSERT INTO ${table} (player_id, server_seed, server_seed_hash, client_seed, nonce)
       VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (player_id) DO NOTHING`,
      [playerId, serverSeed, serverSeedHash, clientSeed],
    )
    const again = await pool.query<{ server_seed_hash: string; client_seed: string; nonce: string }>(
      `SELECT server_seed_hash, client_seed, nonce FROM ${table} WHERE player_id = $1`,
      [playerId],
    )
    const r = again.rows[0]
    return { serverSeedHash: r.server_seed_hash, clientSeed: r.client_seed, nonce: Number(r.nonce) }
  }
  const r = rows[0]
  return { serverSeedHash: r.server_seed_hash, clientSeed: r.client_seed, nonce: Number(r.nonce) }
}

/**
 * Rotate the seed: reveal the retired server seed (so the player can verify
 * every play made against it) and commit a fresh one. An optional
 * player-supplied clientSeed makes the scheme grind-proof.
 */
export async function rotateSeed(table: SeedTable, playerId: string, newClientSeed?: string): Promise<{
  revealedServerSeed: string | null
  revealedServerSeedHash: string | null
  revealedNonce: number | null
  newServerSeedHash: string
  newClientSeed: string
}> {
  const { serverSeed, serverSeedHash } = newServerSeed()
  const clientSeed = newClientSeed && newClientSeed.length > 0 ? newClientSeed : randomBytes(16).toString('hex')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: existing } = await client.query<{
      server_seed: string; server_seed_hash: string; nonce: string
    }>(
      `SELECT server_seed, server_seed_hash, nonce FROM ${table} WHERE player_id = $1 FOR UPDATE`,
      [playerId],
    )

    if (existing.length === 0) {
      await client.query(
        `INSERT INTO ${table} (player_id, server_seed, server_seed_hash, client_seed, nonce)
         VALUES ($1, $2, $3, $4, 0)`,
        [playerId, serverSeed, serverSeedHash, clientSeed],
      )
      await client.query('COMMIT')
      return {
        revealedServerSeed: null, revealedServerSeedHash: null, revealedNonce: null,
        newServerSeedHash: serverSeedHash, newClientSeed: clientSeed,
      }
    }

    const old = existing[0]
    await client.query(
      `UPDATE ${table}
       SET server_seed = $2, server_seed_hash = $3, client_seed = $4, nonce = 0, rotated_at = NOW()
       WHERE player_id = $1`,
      [playerId, serverSeed, serverSeedHash, clientSeed],
    )
    await client.query('COMMIT')
    return {
      revealedServerSeed: old.server_seed,
      revealedServerSeedHash: old.server_seed_hash,
      revealedNonce: Number(old.nonce),
      newServerSeedHash: serverSeedHash,
      newClientSeed: clientSeed,
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
