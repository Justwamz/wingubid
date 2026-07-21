import { pool } from '@betting/db'
import { ALL_PERMISSION_KEYS, SUPER_ADMIN_ROLE_KEY } from '../lib/permissions.js'

const TTL_MS = 30_000
const cache = new Map<string, { perms: Set<string>; at: number }>()

// Effective permission keys for an admin, resolved from their assigned role.
// super_admin resolves to every catalog key (including ones added later).
// Cached briefly per admin; invalidated wholesale on any role change.
export async function getPermissionsForAdmin(adminId: string): Promise<Set<string>> {
  const hit = cache.get(adminId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.perms

  const { rows } = await pool.query<{ role_key: string; perms: string[] }>(
    `SELECT r.key AS role_key,
            COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS perms
     FROM admin_users au
     JOIN roles r ON r.id = au.role_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     WHERE au.id = $1
     GROUP BY r.key`,
    [adminId],
  )

  let perms: Set<string>
  if (rows.length === 0) {
    perms = new Set()
  } else if (rows[0].role_key === SUPER_ADMIN_ROLE_KEY) {
    perms = new Set(ALL_PERMISSION_KEYS)
  } else {
    perms = new Set(rows[0].perms)
  }

  cache.set(adminId, { perms, at: Date.now() })
  return perms
}

export function invalidatePermissionsCache(): void {
  cache.clear()
}
