import { Pool } from 'pg'

function isLocalDb(url: string | undefined): boolean {
  return !url || url.includes('localhost') || url.includes('127.0.0.1')
}

let _pool: Pool | null = null

export function getPool(): Pool {
  if (!_pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required')
    }
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: isLocalDb(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
    })
    _pool.on('error', (err) => {
      console.error('Unexpected pg pool error', err)
    })
  }
  return _pool
}

/** Convenience export — use getPool() if you need lazy initialisation in tests */
export const pool = {
  query: (...args: Parameters<Pool['query']>) => getPool().query(...(args as unknown as [any])),
  connect: () => getPool().connect(),
  end: () => getPool().end(),
} as unknown as Pool
