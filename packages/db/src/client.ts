import { Pool, PoolConfig } from 'pg'

/**
 * Parse a postgres:// URL into explicit pg PoolConfig fields.
 * This bypasses pg-connection-string, which can override the ssl option
 * when no SSL params are present in the URL.
 */
function parseDbUrl(url: string): PoolConfig {
  const u = new URL(url)
  const ssl = process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 5432,
    database: u.pathname.slice(1),
    user: u.username,
    password: decodeURIComponent(u.password),
    ssl,
  }
}

let _pool: Pool | null = null

export function getPool(): Pool {
  if (!_pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required')
    }
    _pool = new Pool({
      ...parseDbUrl(process.env.DATABASE_URL),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
    _pool.on('error', (err) => {
      console.error('Unexpected pg pool error', err)
    })
  }
  return _pool
}

/** Convenience export - use getPool() if you need lazy initialisation in tests */
export const pool = {
  query: (...args: Parameters<Pool['query']>) => getPool().query(...(args as unknown as [any])),
  connect: () => getPool().connect(),
  end: () => getPool().end(),
} as unknown as Pool
