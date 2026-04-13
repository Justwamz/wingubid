import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyPlayerAccessToken } from '../lib/jwt.js'

declare module 'fastify' {
  interface FastifyRequest {
    playerId: string
  }
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } })
    return
  }

  try {
    const payload = verifyPlayerAccessToken(header.slice(7))
    req.playerId = payload.sub
  } catch {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } })
  }
}
