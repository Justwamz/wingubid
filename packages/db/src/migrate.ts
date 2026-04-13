import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Pool, PoolConfig } from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

export async function runMigrations(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required')
  }
  const pool = new Pool(parseDbUrl(process.env.DATABASE_URL))

  const client = await pool.connect()
  let inTransaction = false
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const migrationsDir = path.join(__dirname, '..', 'migrations')
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT id FROM migrations WHERE filename = $1',
        [file]
      )
      if (rows.length > 0) {
        console.log(`  skip  ${file}`)
        continue
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      await client.query('BEGIN')
      inTransaction = true
      await client.query(sql)
      await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file])
      await client.query('COMMIT')
      inTransaction = false
      console.log(`  apply ${file}`)
    }
    console.log('Migrations complete.')
  } catch (err) {
    if (inTransaction) {
      await client.query('ROLLBACK')
    }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

// Allow running directly: pnpm --filter @betting/db migrate
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  runMigrations().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
