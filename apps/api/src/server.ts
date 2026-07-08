import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { healthRoutes } from './routes/health.js'
import { registerRoutes } from './routes/auth/register.js'
import { verifyOtpRoutes } from './routes/auth/verify-otp.js'
import { loginRoutes } from './routes/auth/login.js'
import { refreshRoutes } from './routes/auth/refresh.js'
import { logoutRoutes } from './routes/auth/logout.js'
import { adminAuthRoutes } from './routes/admin/auth.js'
import { adminStatsRoutes } from './routes/admin/stats.js'
import { playerMeRoutes } from './routes/player/me.js'
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
import { gameLeaderboardRoutes } from './routes/games/leaderboard.js'
import { gameHistoryRoutes } from './routes/games/history.js'
import { minesRoutes } from './routes/games/mines.js'
import { diceRoutes } from './routes/games/dice.js'
import { scratchRoutes } from './routes/games/scratch.js'
import { lotteryRoutes } from './routes/games/lottery.js'
import { bannerPublicRoutes } from './routes/banners/public.js'
import { adminBannerRoutes } from './routes/admin/banners.js'
import { adminPlayersRoutes } from './routes/admin/players.js'
import { adminTransactionsRoutes } from './routes/admin/transactions.js'
import { adminGameProviderRoutes } from './routes/admin/game-providers.js'
import { adminGameSlotRoutes } from './routes/admin/game-slots.js'
import { adminPaymentConfigRoutes } from './routes/admin/payment-configs.js'
import { adminSmsConfigRoutes } from './routes/admin/sms-config.js'
import { adminWithdrawalRoutes } from './routes/admin/withdrawals.js'
import { providerGameRoutes } from './routes/games/provider-games.js'

export function buildServer() {
  // trustProxy so req.ip is the real client IP behind Render's proxy — required
  // for per-IP rate limiting to bucket by client rather than by the proxy.
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', trustProxy: true })

  // Fail closed: if CORS_ORIGIN is unset, deny cross-origin rather than
  // reflecting any origin. Never pair credentials:true with origin:true/'*',
  // which would let any site make credentialed requests and read the response.
  const allowedOrigins = (process.env.CORS_ORIGIN ?? '').split(',').map(o => o.trim()).filter(Boolean)
  app.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  })
  app.register(cookie)

  // Rate limiting is opt-in per route (global: false); auth endpoints set their
  // own limits via `config.rateLimit`. In-memory store is fine for a single
  // instance; use the Redis store if the API is scaled horizontally.
  app.register(rateLimit, { global: false })

  app.register(healthRoutes)
  app.register(registerRoutes)
  app.register(verifyOtpRoutes)
  app.register(loginRoutes)
  app.register(refreshRoutes)
  app.register(logoutRoutes)
  app.register(adminAuthRoutes)
  app.register(adminStatsRoutes)
  app.register(playerMeRoutes)

  app.register(walletBalanceRoutes)
  app.register(walletDepositRoutes)
  app.register(walletWithdrawRoutes)

  app.register(mpesaWebhookRoutes)
  app.register(mtnWebhookRoutes)
  app.register(airtelWebhookRoutes)
  app.register(stubWebhookRoutes)

  app.register(providerBalanceRoutes)
  app.register(providerDebitRoutes)
  app.register(providerCreditRoutes)
  app.register(providerRollbackRoutes)

  app.register(gameLeaderboardRoutes)
  app.register(gameHistoryRoutes)
  app.register(minesRoutes)
  app.register(diceRoutes)
  app.register(scratchRoutes)
  app.register(lotteryRoutes)
  app.register(bannerPublicRoutes)
  app.register(adminBannerRoutes)
  app.register(adminPlayersRoutes)
  app.register(adminTransactionsRoutes)
  app.register(adminGameProviderRoutes)
  app.register(adminGameSlotRoutes)
  app.register(adminPaymentConfigRoutes)
  app.register(adminSmsConfigRoutes)
  app.register(adminWithdrawalRoutes)
  app.register(providerGameRoutes)

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
