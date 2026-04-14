import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { healthRoutes } from './routes/health.js'
import { walletBalanceRoutes } from './routes/wallet/balance.js'
import { walletDepositRoutes } from './routes/wallet/deposit.js'
import { walletWithdrawRoutes } from './routes/wallet/withdraw.js'
import { mpesaWebhookRoutes } from './routes/webhooks/mpesa.js'
import { mtnWebhookRoutes } from './routes/webhooks/mtn.js'
import { airtelWebhookRoutes } from './routes/webhooks/airtel.js'
import { stubWebhookRoutes } from './routes/webhooks/stub.js'
import { providerBalanceRoutes } from './routes/provider/balance.js'
import { providerDebitRoutes } from './routes/provider/debit.js'
import { providerCreditRoutes } from './routes/provider/credit.js'
import { providerRollbackRoutes } from './routes/provider/rollback.js'

export function buildServer() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  // JWT secret: read from env directly (not env.ts) so tests can call buildServer() without full env
  const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-minimum-32-characters-long'

  app.register(cors, { origin: true })
  app.register(cookie)
  app.register(jwt, { secret: jwtSecret })
  app.register(healthRoutes)

  // Wallet routes (player-authenticated)
  app.register(walletBalanceRoutes)
  app.register(walletDepositRoutes)
  app.register(walletWithdrawRoutes)

  // Payment webhooks (no auth — providers call these)
  app.register(mpesaWebhookRoutes)
  app.register(mtnWebhookRoutes)
  app.register(airtelWebhookRoutes)
  app.register(stubWebhookRoutes)

  // Provider wallet API (HMAC-authenticated)
  app.register(providerBalanceRoutes)
  app.register(providerDebitRoutes)
  app.register(providerCreditRoutes)
  app.register(providerRollbackRoutes)

  app.setErrorHandler((error, _req, reply) => {
    const statusCode = error.statusCode ?? 500
    reply.status(statusCode).send({
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: statusCode >= 500 ? 'Internal server error' : error.message,
      },
    })
  })

  return app
}
