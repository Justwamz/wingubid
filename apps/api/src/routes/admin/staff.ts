import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { hashPassword } from '../../lib/hash.js'
import { AppError } from '../../lib/errors.js'
import { invalidatePermissionsCache } from '../../services/permissions.service.js'
import { getLdapConfig, setLdapConfig } from '../../services/ldap-config.service.js'
import { DEFAULT_LDAP_CONFIG } from '../../lib/ldap-auth.js'
import { SUPER_ADMIN_ROLE_KEY } from '../../lib/permissions.js'

async function audit(adminId: string, action: string, entityId: string | null, after: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO admin_audit_log (admin_id, action, entity, entity_id, after) VALUES ($1, $2, 'staff', $3, $4::jsonb)`,
    [adminId, action, entityId, JSON.stringify(after ?? {})],
  )
}

// Number of OTHER active super admins (excluding a given id).
async function otherActiveSuperAdmins(excludeId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM admin_users au
     JOIN roles r ON r.id = au.role_id
     WHERE r.key = $1 AND au.status = 'active' AND au.id <> $2`,
    [SUPER_ADMIN_ROLE_KEY, excludeId],
  )
  return Number(rows[0].n)
}

export async function adminStaffRoutes(app: FastifyInstance) {
  app.get('/admin/staff', { preHandler: [authenticateAdmin, requirePermission('staff.view')] }, async (_req, reply) => {
    const { rows } = await pool.query(
      `SELECT au.id, au.name, au.email, au.status, au.auth_provider, au.last_login_at,
              au.role_id, r.name AS role_name, r.key AS role_key
       FROM admin_users au
       LEFT JOIN roles r ON r.id = au.role_id
       ORDER BY au.name ASC`,
    )
    return reply.send({ staff: rows })
  })

  app.post('/admin/staff', { preHandler: [authenticateAdmin, requirePermission('staff.create')] }, async (req, reply) => {
    const parsed = z.object({
      name: z.string().min(1).max(255),
      email: z.string().email(),
      roleId: z.string().uuid(),
      password: z.string().min(8, 'Password must be at least 8 characters.'),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    const { rows: roleRows } = await pool.query<{ id: string; key: string }>(`SELECT id, key FROM roles WHERE id = $1`, [parsed.data.roleId])
    if (roleRows.length === 0) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Unknown role.' } })

    const hash = await hashPassword(parsed.data.password)
    try {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO admin_users (name, email, password_hash, role, role_id, status, must_change_password, created_by)
         VALUES ($1, $2, $3, $4, $5, 'active', true, $6) RETURNING id`,
        [parsed.data.name, parsed.data.email, hash, roleRows[0].key, roleRows[0].id, req.adminId],
      )
      await audit(req.adminId, 'staff_create', rows[0].id, { email: parsed.data.email, roleId: parsed.data.roleId })
      return reply.send({ id: rows[0].id })
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.status(409).send({ error: { code: 'EMAIL_TAKEN', message: 'That email is already in use.' } })
      }
      throw err
    }
  })

  app.put('/admin/staff/:id', { preHandler: [authenticateAdmin, requirePermission('staff.edit')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({
      name: z.string().min(1).max(255).optional(),
      roleId: z.string().uuid().optional(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    // Guardrail: moving the last active super admin off super_admin is blocked.
    if (parsed.data.roleId) {
      const { rows: cur } = await pool.query<{ role_key: string; status: string }>(
        `SELECT r.key AS role_key, au.status FROM admin_users au JOIN roles r ON r.id = au.role_id WHERE au.id = $1`, [id],
      )
      if (cur.length && cur[0].role_key === SUPER_ADMIN_ROLE_KEY && cur[0].status === 'active') {
        const { rows: newRole } = await pool.query<{ key: string }>(`SELECT key FROM roles WHERE id = $1`, [parsed.data.roleId])
        if (newRole.length && newRole[0].key !== SUPER_ADMIN_ROLE_KEY && (await otherActiveSuperAdmins(id)) === 0) {
          return reply.status(409).send({ error: { code: 'LAST_SUPER_ADMIN', message: 'You cannot remove the last active Super Admin.' } })
        }
      }
    }

    let roleKey: string | null = null
    if (parsed.data.roleId) {
      const { rows } = await pool.query<{ key: string }>(`SELECT key FROM roles WHERE id = $1`, [parsed.data.roleId])
      if (rows.length === 0) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Unknown role.' } })
      roleKey = rows[0].key
    }

    const { rowCount } = await pool.query(
      `UPDATE admin_users SET
         name = COALESCE($2, name),
         role_id = COALESCE($3, role_id),
         role = COALESCE($4, role)
       WHERE id = $1`,
      [id, parsed.data.name ?? null, parsed.data.roleId ?? null, roleKey],
    )
    if (!rowCount) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Staff not found.' } })
    invalidatePermissionsCache()
    await audit(req.adminId, 'staff_update', id, parsed.data)
    return reply.send({ ok: true })
  })

  app.put('/admin/staff/:id/status', { preHandler: [authenticateAdmin, requirePermission('staff.suspend')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({ status: z.enum(['active', 'suspended']) }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid status.' } })

    if (id === req.adminId && parsed.data.status === 'suspended') {
      return reply.status(409).send({ error: { code: 'CANNOT_SUSPEND_SELF', message: 'You cannot suspend your own account.' } })
    }

    const { rows } = await pool.query<{ id: string; role_key: string; status: string }>(
      `SELECT au.id, r.key AS role_key, au.status FROM admin_users au JOIN roles r ON r.id = au.role_id WHERE au.id = $1`, [id],
    )
    if (rows.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Staff not found.' } })

    if (parsed.data.status === 'suspended' && rows[0].role_key === SUPER_ADMIN_ROLE_KEY) {
      if ((await otherActiveSuperAdmins(id)) === 0) {
        return reply.status(409).send({ error: { code: 'LAST_SUPER_ADMIN', message: 'You cannot suspend the last active Super Admin.' } })
      }
    }

    await pool.query(`UPDATE admin_users SET status = $2 WHERE id = $1`, [id, parsed.data.status])
    invalidatePermissionsCache()
    await audit(req.adminId, 'staff_status', id, { status: parsed.data.status })
    return reply.send({ ok: true })
  })

  app.post('/admin/staff/:id/reset-password', { preHandler: [authenticateAdmin, requirePermission('staff.reset_password')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({ password: z.string().min(8, 'Password must be at least 8 characters.') }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    const hash = await hashPassword(parsed.data.password)
    const { rowCount } = await pool.query(
      `UPDATE admin_users SET password_hash = $2, must_change_password = true WHERE id = $1`, [id, hash],
    )
    if (!rowCount) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Staff not found.' } })
    await audit(req.adminId, 'staff_reset_password', id, {})
    return reply.send({ ok: true })
  })

  // LDAP config (directory / SSO): gated with the staff permissions since it is
  // an access-administration concern. bindPassword is never returned.
  app.get('/admin/ldap-config', { preHandler: [authenticateAdmin, requirePermission('staff.view')] }, async (_req, reply) => {
    const cfg = await getLdapConfig()
    const { bindPassword, ...safe } = cfg
    return reply.send({ config: { ...safe, hasBindPassword: Boolean(bindPassword) } })
  })

  app.put('/admin/ldap-config', { preHandler: [authenticateAdmin, requirePermission('staff.edit')] }, async (req, reply) => {
    const parsed = z.object({
      enabled: z.boolean(),
      host: z.string(),
      port: z.number().int().min(1).max(65535),
      useTls: z.boolean(),
      baseDN: z.string(),
      bindDN: z.string(),
      bindPassword: z.string().optional(), // omit/empty keeps the stored one
      userFilter: z.string(),
      groupAttribute: z.string(),
      groupRoleMap: z.record(z.string()),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    const current = await getLdapConfig()
    const next = {
      ...DEFAULT_LDAP_CONFIG,
      ...parsed.data,
      bindPassword: parsed.data.bindPassword && parsed.data.bindPassword.length > 0
        ? parsed.data.bindPassword
        : current.bindPassword,
    }
    await setLdapConfig(next)
    await audit(req.adminId, 'ldap_config_update', null, { enabled: next.enabled, host: next.host })
    return reply.send({ ok: true })
  })
}
