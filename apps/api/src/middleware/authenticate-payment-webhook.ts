import crypto from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { env } from '../env.js'

/**
 * Authenticates inbound payment-provider callbacks (M-Pesa / MTN / Airtel).
 *
 * This is a shared-secret guard that FAILS CLOSED: callers must present the
 * configured secret in the `x-webhook-secret` header, and if no secret is
 * configured the endpoint rejects everything. That closes the forged-callback
 * hole while no real provider is connected — these routes are unused until a
 * provider is wired up and a secret is set.
 *
 * IMPORTANT: before going live with a real provider you MUST additionally
 * implement that provider's native verification, because a static header
 * secret is not how these providers authenticate:
 *   - M-Pesa: restrict to Safaricom source IPs + a secret confirmation-URL
 *     path token (Safaricom cannot send an arbitrary header).
 *   - Airtel / MTN: verify the HMAC signature the provider sends over the
 *     callback body against the stored provider secret.
 */
export function authenticatePaymentWebhook(req: FastifyRequest, reply: FastifyReply): void {
  const configured = env.PAYMENT_WEBHOOK_SECRET

  // Fail closed: no secret configured means these callbacks are not in use.
  if (!configured) {
    req.log.warn('Rejected payment webhook: PAYMENT_WEBHOOK_SECRET is not configured')
    reply.status(401).send({ error: { code: 'WEBHOOK_DISABLED', message: 'Payment webhooks are not configured' } })
    return
  }

  const provided = req.headers['x-webhook-secret']
  if (typeof provided !== 'string' || provided.length === 0) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing webhook secret' } })
    return
  }

  const a = Buffer.from(provided)
  const b = Buffer.from(configured)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook secret' } })
    return
  }
}
