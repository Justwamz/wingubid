import type { FastifyRequest, FastifyReply } from 'fastify'
import type fastifyJwt from '@fastify/jwt'

declare module 'fastify' {
  interface FastifyRequest {
    playerId: string
  }
}

// Augment the fastifyJwt namespace so TypeScript knows the shape of req.user
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: string }
    user: { sub: string; role: string }
  }
}

export async function authenticate(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await req.jwtVerify()
    req.playerId = req.user.sub
  } catch {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' } })
  }
}

// Re-export so the augmentation is picked up
export type { fastifyJwt }
