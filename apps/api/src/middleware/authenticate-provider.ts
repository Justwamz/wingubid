import crypto from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    providerId: string
  }
}

export async function authenticateProvider(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const providerId = req.headers['x-provider-id'] as string | undefined
  const timestamp = req.headers['x-timestamp'] as string | undefined
  const signature = req.headers['x-signature'] as string | undefined

  if (!providerId || !timestamp || !signature) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing auth headers' } })
    return
  }

  const tsNum = parseInt(timestamp, 10)
  const nowSec = Math.floor(Date.now() / 1000)
  if (isNaN(tsNum) || Math.abs(nowSec - tsNum) > 60) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Request expired' } })
    return
  }

  const secret = process.env[`PROVIDER_SECRET_${providerId.toUpperCase()}`]
  if (!secret) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unknown provider' } })
    return
  }

  const bodyStr = req.body ? JSON.stringify(req.body) : ''
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex')
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${providerId}${timestamp}${req.method}${req.url}${bodyHash}`)
    .digest('hex')

  // Constant-time comparison
  if (signature.length !== expected.length) {
    reply.status(401).send({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } })
    return
  }
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
    reply.status(401).send({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } })
    return
  }

  req.providerId = providerId
}
