import { Client } from 'ldapts'
import { AppError } from './errors.js'

export interface LdapConfig {
  enabled: boolean
  host: string
  port: number
  useTls: boolean
  baseDN: string
  bindDN: string
  bindPassword: string
  userFilter: string       // template with {{login}}, e.g. '(mail={{login}})'
  groupAttribute: string   // e.g. 'memberOf'
  groupRoleMap: Record<string, string> // ldap group value -> role key
}

export interface LdapProfile {
  dn: string
  email: string
  name: string
  groups: string[]
}

export const DEFAULT_LDAP_CONFIG: LdapConfig = {
  enabled: false,
  host: '',
  port: 636,
  useTls: true,
  baseDN: '',
  bindDN: '',
  bindPassword: '',
  userFilter: '(mail={{login}})',
  groupAttribute: 'memberOf',
  groupRoleMap: {},
}

function url(cfg: LdapConfig): string {
  const scheme = cfg.useTls ? 'ldaps' : 'ldap'
  return `${scheme}://${cfg.host}:${cfg.port}`
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (v == null) return []
  return [String(v)]
}

// Real LDAP authentication: service-bind, find the user, rebind AS the user to
// verify the password, then read group membership. Directory-only; the caller
// maps groups to a role. Dormant in production until ldap_config.enabled is true.
export async function ldapAuthenticate(
  cfg: LdapConfig,
  loginId: string,
  password: string,
): Promise<LdapProfile> {
  const client = new Client({ url: url(cfg) })
  try {
    // 1. Service bind (skip if no service account configured).
    if (cfg.bindDN) {
      try {
        await client.bind(cfg.bindDN, cfg.bindPassword)
      } catch {
        throw new AppError('LDAP_SERVICE_BIND_FAILED', 'Directory service bind failed.', 502)
      }
    }

    // 2. Find the user under baseDN.
    const filter = cfg.userFilter.replace('{{login}}', loginId)
    const { searchEntries } = await client.search(cfg.baseDN, {
      scope: 'sub',
      filter,
      attributes: ['dn', 'mail', 'cn', cfg.groupAttribute],
    })
    if (searchEntries.length === 0) {
      throw new AppError('LDAP_USER_NOT_FOUND', 'No matching directory user.', 401)
    }
    const entry = searchEntries[0] as Record<string, unknown>
    const dn = String(entry.dn)

    // 3. Verify the password by binding AS the user.
    try {
      await client.bind(dn, password)
    } catch {
      throw new AppError('LDAP_AUTH_FAILED', 'Invalid directory credentials.', 401)
    }

    return {
      dn,
      email: entry.mail ? String(entry.mail) : loginId,
      name: entry.cn ? String(entry.cn) : loginId,
      groups: asArray(entry[cfg.groupAttribute]),
    }
  } finally {
    try {
      await client.unbind()
    } catch {
      // ignore unbind errors
    }
  }
}
