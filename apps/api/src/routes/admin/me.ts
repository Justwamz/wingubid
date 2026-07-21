import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { getPermissionsForAdmin } from '../../services/permissions.service.js'
import { hashPassword, verifyPassword } from '../../lib/hash.js'

export async function adminMeRoutes(app: FastifyInstance) {
  app.get('/admin/me', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { rows } = await pool.query<{ id: string; name: string; email: string; role_name: string | null }>(
      `SELECT au.id, au.name, au.email, r.name AS role_name
       FROM admin_users au LEFT JOIN roles r ON r.id = au.role_id WHERE au.id = $1`,
      [req.adminId],
    )
    if (rows.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Account not found.' } })
    const perms = await getPermissionsForAdmin(req.adminId)
    return reply.send({
      id: rows[0].id, name: rows[0].name, email: rows[0].email,
      role: rows[0].role_name, roleKey: req.adminRole,
      permissions: Array.from(perms),
    })
  })

  app.post('/admin/change-password', { preHandler: authenticateAdmin }, async (req, reply) => {
    const parsed = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, 'Password must be at least 8 characters.'),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    const { rows } = await pool.query<{ password_hash: string }>(`SELECT password_hash FROM admin_users WHERE id = $1`, [req.adminId])
    if (rows.length === 0) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Account not found.' } })
    const ok = await verifyPassword(parsed.data.currentPassword, rows[0].password_hash)
    if (!ok) return reply.status(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Your current password is incorrect.' } })

    const hash = await hashPassword(parsed.data.newPassword)
    await pool.query(`UPDATE admin_users SET password_hash = $2, must_change_password = false WHERE id = $1`, [req.adminId, hash])
    return reply.send({ ok: true })
  })
}
