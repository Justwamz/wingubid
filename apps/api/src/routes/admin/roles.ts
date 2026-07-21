import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { invalidatePermissionsCache } from '../../services/permissions.service.js'
import { PERMISSION_CATALOG, ALL_PERMISSION_KEYS, isValidPermission, SUPER_ADMIN_ROLE_KEY } from '../../lib/permissions.js'

async function audit(adminId: string, action: string, entityId: string | null, after: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO admin_audit_log (admin_id, action, entity, entity_id, after) VALUES ($1, $2, 'role', $3, $4::jsonb)`,
    [adminId, action, entityId, JSON.stringify(after ?? {})],
  )
}

export async function adminRolesRoutes(app: FastifyInstance) {
  app.get('/admin/permissions-catalog', { preHandler: [authenticateAdmin, requirePermission('roles.view')] }, async (_req, reply) => {
    return reply.send({ catalog: PERMISSION_CATALOG })
  })

  app.get('/admin/roles', { preHandler: [authenticateAdmin, requirePermission('roles.view')] }, async (_req, reply) => {
    const { rows } = await pool.query<{ id: string; key: string; name: string; description: string | null; is_system: boolean; perms: string[] }>(
      `SELECT r.id, r.key, r.name, r.description, r.is_system,
              COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS perms
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
       GROUP BY r.id ORDER BY r.is_system DESC, r.name ASC`,
    )
    const roles = rows.map(r => ({
      id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.is_system,
      locked: r.key === SUPER_ADMIN_ROLE_KEY,
      permissions: r.key === SUPER_ADMIN_ROLE_KEY ? ALL_PERMISSION_KEYS : r.perms,
    }))
    return reply.send({ roles })
  })

  app.post('/admin/roles', { preHandler: [authenticateAdmin, requirePermission('roles.create')] }, async (req, reply) => {
    const parsed = z.object({
      key: z.string().min(2).max(40).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers, underscores.'),
      name: z.string().min(1).max(80),
      description: z.string().max(255).optional(),
      permissions: z.array(z.string()).default([]),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    const bad = parsed.data.permissions.filter(k => !isValidPermission(k))
    if (bad.length) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: `Unknown permission: ${bad[0]}` } })
    if (parsed.data.key === SUPER_ADMIN_ROLE_KEY) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Reserved role key.' } })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO roles (key, name, description, is_system) VALUES ($1, $2, $3, false) RETURNING id`,
        [parsed.data.key, parsed.data.name, parsed.data.description ?? null],
      )
      const roleId = rows[0].id
      for (const key of parsed.data.permissions) {
        await client.query(`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)`, [roleId, key])
      }
      await client.query('COMMIT')
      invalidatePermissionsCache()
      await audit(req.adminId, 'role_create', roleId, { key: parsed.data.key, permissions: parsed.data.permissions })
      return reply.send({ id: roleId })
    } catch (err) {
      await client.query('ROLLBACK')
      if ((err as { code?: string }).code === '23505') {
        return reply.status(409).send({ error: { code: 'ROLE_KEY_TAKEN', message: 'That role key already exists.' } })
      }
      throw err
    } finally {
      client.release()
    }
  })

  app.put('/admin/roles/:id', { preHandler: [authenticateAdmin, requirePermission('roles.edit')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = z.object({
      name: z.string().min(1).max(80).optional(),
      description: z.string().max(255).optional(),
      permissions: z.array(z.string()).optional(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    const { rows: roleRows } = await pool.query<{ key: string }>(`SELECT key FROM roles WHERE id = $1`, [id])
    if (roleRows.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Role not found.' } })
    if (roleRows[0].key === SUPER_ADMIN_ROLE_KEY) {
      return reply.status(403).send({ error: { code: 'ROLE_LOCKED', message: 'The Super Admin role cannot be edited.' } })
    }
    if (parsed.data.permissions) {
      const bad = parsed.data.permissions.filter(k => !isValidPermission(k))
      if (bad.length) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: `Unknown permission: ${bad[0]}` } })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      if (parsed.data.name !== undefined || parsed.data.description !== undefined) {
        await client.query(
          `UPDATE roles SET name = COALESCE($2, name), description = COALESCE($3, description) WHERE id = $1`,
          [id, parsed.data.name ?? null, parsed.data.description ?? null],
        )
      }
      if (parsed.data.permissions) {
        await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [id])
        for (const key of parsed.data.permissions) {
          await client.query(`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)`, [id, key])
        }
      }
      await client.query('COMMIT')
      invalidatePermissionsCache()
      await audit(req.adminId, 'role_update', id, parsed.data)
      return reply.send({ ok: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  app.delete('/admin/roles/:id', { preHandler: [authenticateAdmin, requirePermission('roles.delete')] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await pool.query<{ id: string; key: string; is_system: boolean }>(`SELECT id, key, is_system FROM roles WHERE id = $1`, [id])
    if (rows.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Role not found.' } })
    if (rows[0].is_system) return reply.status(403).send({ error: { code: 'ROLE_LOCKED', message: 'System roles cannot be deleted.' } })

    const { rows: usage } = await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM admin_users WHERE role_id = $1`, [id])
    if (Number(usage[0].n) > 0) {
      return reply.status(409).send({ error: { code: 'ROLE_IN_USE', message: 'Reassign staff off this role before deleting it.' } })
    }

    await pool.query(`DELETE FROM roles WHERE id = $1`, [id])
    invalidatePermissionsCache()
    await audit(req.adminId, 'role_delete', id, { key: rows[0].key })
    return reply.send({ ok: true })
  })
}
