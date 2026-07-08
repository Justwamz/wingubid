import { pool } from '@betting/db'

export interface SmsConfig {
  provider: string
  enabled: boolean
  apiKey: string
  username: string
  senderId: string
}

const DEFAULT: SmsConfig = { provider: 'africastalking', enabled: false, apiKey: '', username: '', senderId: '' }

// Short cache so we don't hit the DB on every SMS send / auth request. A toggle
// in the admin UI invalidates it in this process immediately; other instances
// pick it up within the TTL.
let cache: { value: SmsConfig; expiresAt: number } | null = null
const CACHE_TTL_MS = 30_000

export function invalidateSmsConfigCache(): void {
  cache = null
}

export async function getSmsConfig(): Promise<SmsConfig> {
  if (cache && cache.expiresAt > Date.now()) return cache.value

  const { rows } = await pool.query<{
    provider: string; enabled: boolean; config: Record<string, string>
  }>(`SELECT provider, enabled, config FROM sms_configs ORDER BY updated_at DESC LIMIT 1`)

  const row = rows[0]
  const value: SmsConfig = row
    ? {
        provider: row.provider,
        enabled: row.enabled,
        apiKey: row.config?.apiKey ?? '',
        username: row.config?.username ?? '',
        senderId: row.config?.senderId ?? '',
      }
    : DEFAULT

  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS }
  return value
}

/** Whether OTP/SMS is live (admin toggled it on). */
export async function smsEnabled(): Promise<boolean> {
  return (await getSmsConfig()).enabled
}
