import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyAdminAccessToken } from '../lib/jwt.js'

declare module 'fastify' {
  interface FastifyRequest {
    adminId: string
    adminRole: string
  }
}

export async function authenticateAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } })
    return
  }
  try {
    const payload = verifyAdminAccessToken(header.slice(7))
    req.adminId = payload.sub
    req.adminRole = payload.role
  } catch {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } })
  }
}
