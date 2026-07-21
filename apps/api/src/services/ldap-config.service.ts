import { pool } from '@betting/db'
import { DEFAULT_LDAP_CONFIG, type LdapConfig } from '../lib/ldap-auth.js'

const KEY = 'ldap_config'

export async function getLdapConfig(): Promise<LdapConfig> {
  const { rows } = await pool.query<{ value: unknown }>(
    `SELECT value FROM game_settings WHERE key = $1`, [KEY],
  )
  if (rows.length === 0) return { ...DEFAULT_LDAP_CONFIG }
  return { ...DEFAULT_LDAP_CONFIG, ...(rows[0].value as Partial<LdapConfig>) }
}

export async function setLdapConfig(cfg: LdapConfig): Promise<void> {
  await pool.query(
    `INSERT INTO game_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [KEY, JSON.stringify(cfg)],
  )
}
