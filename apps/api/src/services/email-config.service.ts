import { pool } from '@betting/db'

export interface EmailConfig {
  enabled: boolean
  provider: 'resend' | 'sendgrid'
  apiKey: string
  fromEmail: string
  toEmail: string
}

const TTL_MS = 30_000
let cache: { value: EmailConfig; at: number } | null = null

export function invalidateEmailConfigCache(): void {
  cache = null
}

export async function getEmailConfig(): Promise<EmailConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value

  const { rows } = await pool.query<{ enabled: boolean; config: Record<string, string> }>(
    `SELECT enabled, config FROM email_configs ORDER BY updated_at DESC LIMIT 1`,
  )
  const c = rows[0]?.config ?? {}
  const value: EmailConfig = {
    enabled: rows[0]?.enabled ?? false,
    provider: (c.provider === 'sendgrid' ? 'sendgrid' : 'resend'),
    apiKey: c.apiKey ?? '',
    fromEmail: c.fromEmail ?? '',
    toEmail: c.toEmail ?? 'withdrawals@wingubet.com',
  }
  cache = { value, at: Date.now() }
  return value
}
