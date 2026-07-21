import type { FastifyRequest, FastifyReply } from 'fastify'
import { getPermissionsForAdmin } from '../services/permissions.service.js'

// Use AFTER authenticateAdmin, which sets req.adminId:
//   { preHandler: [authenticateAdmin, requirePermission('staff.view')] }
export function requirePermission(key: string) {
  return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const perms = await getPermissionsForAdmin(req.adminId)
    if (!perms.has(key)) {
      reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' },
      })
    }
  }
}
