import { randomBytes, createHash } from 'crypto'
import type { PoolClient } from '@betting/db'
import { pool } from '@betting/db'

export interface DiceSeedRoll {
  serverSeed: string
  serverSeedHash: string
  clientSeed: string
  nonce: number
}

function newServerSeed(): { serverSeed: string; serverSeedHash: string } {
  const serverSeed = randomBytes(32).toString('hex')
  const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex')
  return { serverSeed, serverSeedHash }
}

/**
 * Atomically claim the next nonce for a player's active dice seed, creating the
 * seed on first use. The INSERT ... ON CONFLICT DO UPDATE runs as a single
 * statement, so concurrent rolls can never read the same nonce (fixes the old
 * COUNT(*) race). Returns the seed + the just-claimed nonce to compute the roll.
 */
export async function nextDiceRoll(client: PoolClient, playerId: string): Promise<DiceSeedRoll> {
  const { serverSeed, serverSeedHash } = newServerSeed()
  const clientSeed = randomBytes(16).toString('hex')

  const { rows } = await client.query<{
    server_seed: string; server_seed_hash: string; client_seed: string; nonce: string
  }>(
    `INSERT INTO dice_seeds (player_id, server_seed, server_seed_hash, client_seed, nonce)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (player_id) DO UPDATE SET nonce = dice_seeds.nonce + 1
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

/** The current commitment (never exposes the raw server seed). */
export async function getDiceCommitment(playerId: string): Promise<{
  serverSeedHash: string; clientSeed: string; nonce: number
}> {
  const { rows } = await pool.query<{ server_seed_hash: string; client_seed: string; nonce: string }>(
    `SELECT server_seed_hash, client_seed, nonce FROM dice_seeds WHERE player_id = $1`,
    [playerId],
  )
  if (rows.length === 0) {
    // No rolls yet — mint a seed so the player can see the commitment up front.
    const { serverSeed, serverSeedHash } = newServerSeed()
    const clientSeed = randomBytes(16).toString('hex')
    await pool.query(
      `INSERT INTO dice_seeds (player_id, server_seed, server_seed_hash, client_seed, nonce)
       VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (player_id) DO NOTHING`,
      [playerId, serverSeed, serverSeedHash, clientSeed],
    )
    const again = await pool.query<{ server_seed_hash: string; client_seed: string; nonce: string }>(
      `SELECT server_seed_hash, client_seed, nonce FROM dice_seeds WHERE player_id = $1`,
      [playerId],
    )
    const r = again.rows[0]
    return { serverSeedHash: r.server_seed_hash, clientSeed: r.client_seed, nonce: Number(r.nonce) }
  }
  const r = rows[0]
  return { serverSeedHash: r.server_seed_hash, clientSeed: r.client_seed, nonce: Number(r.nonce) }
}

/**
 * Rotate the seed: reveal the current (now-retired) server seed so the player
 * can verify every roll made against it, and commit a fresh one. An optional
 * player-supplied clientSeed lets the player influence future outcomes, which
 * is what makes the scheme grind-proof (the server commits its seed hash before
 * it knows the client seed).
 */
export async function rotateDiceSeed(playerId: string, newClientSeed?: string): Promise<{
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
      `SELECT server_seed, server_seed_hash, nonce FROM dice_seeds WHERE player_id = $1 FOR UPDATE`,
      [playerId],
    )

    if (existing.length === 0) {
      await client.query(
        `INSERT INTO dice_seeds (player_id, server_seed, server_seed_hash, client_seed, nonce)
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
      `UPDATE dice_seeds
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
