import crypto from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { pool } from '@betting/db'

declare module 'fastify' {
  interface FastifyRequest {
    providerId: string
  }
}

// Simple in-memory cache so we don't hit the DB on every webhook call.
const secretCache = new Map<string, { secret: string; expiresAt: number }>()
const CACHE_TTL_MS = 60_000

async function resolveSecret(slug: string): Promise<string | null> {
  const cached = secretCache.get(slug)
  if (cached && cached.expiresAt > Date.now()) return cached.secret

  const { rows } = await pool.query<{ api_secret: string }>(
    `SELECT api_secret FROM game_providers WHERE slug = $1 AND active = true LIMIT 1`,
    [slug],
  )
  if (rows.length === 0) return null

  const secret = rows[0].api_secret
  secretCache.set(slug, { secret, expiresAt: Date.now() + CACHE_TTL_MS })
  return secret
}

export async function authenticateProvider(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const providerId = req.headers['x-provider-id'] as string | undefined
  const timestamp  = req.headers['x-timestamp']  as string | undefined
  const signature  = req.headers['x-signature']  as string | undefined

  if (!providerId || !timestamp || !signature) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing auth headers' } })
    return
  }

  const tsNum  = parseInt(timestamp, 10)
  const nowSec = Math.floor(Date.now() / 1000)
  if (isNaN(tsNum) || Math.abs(nowSec - tsNum) > 60) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Request expired' } })
    return
  }

  // Look up secret from DB (with cache), fall back to env var for legacy support.
  const secret =
    (await resolveSecret(providerId)) ??
    process.env[`PROVIDER_SECRET_${providerId.toUpperCase()}`] ??
    null

  if (!secret) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unknown provider' } })
    return
  }

  const bodyStr  = req.body ? JSON.stringify(req.body) : ''
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex')
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${providerId}${timestamp}${req.method}${req.url}${bodyHash}`)
    .digest('hex')

  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    reply.status(401).send({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } })
    return
  }

  req.providerId = providerId
}
