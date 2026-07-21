import { pool } from '@betting/db'
import { verifyPassword } from '../lib/hash.js'
import { AppError } from '../lib/errors.js'
import { getLdapConfig } from './ldap-config.service.js'
import { ldapAuthenticate } from '../lib/ldap-auth.js'

export interface StaffAuthResult {
  id: string
  name: string
  email: string
  role: string
  mustChangePassword: boolean
}

interface StaffRow {
  id: string
  name: string
  email: string
  role: string
  status: string
  password_hash: string
  auth_provider: string
  must_change_password: boolean
}

export async function authenticateStaff(email: string, password: string): Promise<StaffAuthResult> {
  const { rows } = await pool.query<StaffRow>(
    `SELECT id, name, email, role, status, password_hash, auth_provider, must_change_password
     FROM admin_users WHERE email = $1`,
    [email],
  )
  if (rows.length === 0) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
  const u = rows[0]

  // LDAP branch: dormant by default (provider defaults 'local', config disabled).
  if (u.auth_provider === 'ldap') {
    const cfg = await getLdapConfig()
    if (cfg.enabled) {
      const profile = await ldapAuthenticate(cfg, email, password)
      const mapped = Object.entries(cfg.groupRoleMap).find(([g]) => profile.groups.includes(g))
      if (!mapped) throw new AppError('LDAP_NO_ROLE', 'Your directory groups do not map to a role.', 403)
      if (u.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED', 'This account has been suspended.', 403)
      return { id: u.id, name: u.name, email: u.email, role: mapped[1], mustChangePassword: false }
    }
    // enabled=false: fall through to local (no valid local hash => rejected).
  }

  const ok = await verifyPassword(password, u.password_hash)
  if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
  if (u.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED', 'This account has been suspended.', 403)

  return { id: u.id, name: u.name, email: u.email, role: u.role, mustChangePassword: u.must_change_password }
}
