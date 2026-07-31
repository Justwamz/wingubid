import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { AppError } from './lib/errors.js'
import { healthRoutes } from './routes/health.js'
import { registerRoutes } from './routes/auth/register.js'
import { verifyOtpRoutes } from './routes/auth/verify-otp.js'
import { loginRoutes } from './routes/auth/login.js'
import { refreshRoutes } from './routes/auth/refresh.js'
import { logoutRoutes } from './routes/auth/logout.js'
import { adminAuthRoutes } from './routes/admin/auth.js'
import { adminStatsRoutes } from './routes/admin/stats.js'
import { playerMeRoutes } from './routes/player/me.js'
import { bonusPlayerRoutes } from './routes/bonuses.js'
import { walletBalanceRoutes } from './routes/wallet/balance.js'
import { walletDepositRoutes } from './routes/wallet/deposit.js'
import { walletWithdrawRoutes } from './routes/wallet/withdraw.js'
import { mpesaWebhookRoutes } from './routes/webhooks/mpesa.js'
import { mpesaC2bRoutes } from './routes/webhooks/mpesa-c2b.js'
import { mtnWebhookRoutes } from './routes/webhooks/mtn.js'
import { airtelWebhookRoutes } from './routes/webhooks/airtel.js'
import { stubWebhookRoutes } from './routes/webhooks/stub.js'
import { providerBalanceRoutes } from './routes/provider/balance.js'
import { providerDebitRoutes } from './routes/provider/debit.js'
import { providerCreditRoutes } from './routes/provider/credit.js'
import { providerRollbackRoutes } from './routes/provider/rollback.js'
import { gameLeaderboardRoutes } from './routes/games/leaderboard.js'
import { gameHistoryRoutes } from './routes/games/history.js'
import { gameConfigRoutes } from './routes/games/config.js'
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
import { adminEmailConfigRoutes } from './routes/admin/email-config.js'
import { adminGameSettingsRoutes } from './routes/admin/game-settings.js'
import { adminTaxRoutes } from './routes/admin/tax.js'
import { adminWithdrawalRoutes } from './routes/admin/withdrawals.js'
import { adminC2bRoutes } from './routes/admin/c2b.js'
import { adminNotificationRoutes } from './routes/admin/notifications.js'
import { adminStaffRoutes } from './routes/admin/staff.js'
import { adminBonusRoutes } from './routes/admin/bonuses.js'
import { adminCampaignRoutes } from './routes/admin/campaigns.js'
import { adminRolesRoutes } from './routes/admin/roles.js'
import { adminMeRoutes } from './routes/admin/me.js'
import { chatRoutes } from './routes/chat.js'
import { adminChatRoutes } from './routes/admin/chat.js'
import { providerGameRoutes } from './routes/games/provider-games.js'

export function buildServer() {
  // trustProxy so req.ip is the real client IP behind Render's proxy - required
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
  // NOTE: @fastify/rate-limit throws whatever errorResponseBuilder returns and
  // relies on the app's error handler (below) to render it, which reads
  // top-level `statusCode`/`code`/`message` (not a nested `error` object) - so
  // those must be set at the top level here, not nested.
  app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, context) => ({
      // The plugin's own context type omits `statusCode` even though it sets
      // one internally (429, or 403 if `ban` is configured and tripped);
      // `context.ban` is typed, so derive it the same way rather than reading
      // the untyped property.
      statusCode: context.ban ? 403 : 429,
      code: 'TOO_MANY_REQUESTS',
      message: "You're doing that too fast. Please wait a minute and try again.",
    }),
  })

  // Plain-English fallbacks so users never see a raw status code or stack trace.
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: "We couldn't find what you were looking for." } })
  })

  app.setErrorHandler((err, req, reply) => {
    // Our own, user-safe errors carry a friendly message + code already.
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    }
    // Malformed body / schema validation.
    if ((err as { validation?: unknown }).validation || (err as { statusCode?: number }).statusCode === 400) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: "Some of the details you entered don't look right. Please check them and try again." } })
    }
    // Errors carrying an explicit client-error status + code (e.g. the rate
    // limiter's thrown { statusCode, code, message }): surface them as-is.
    const status = (err as { statusCode?: number }).statusCode ?? 500
    const code = (err as { code?: string }).code
    if (status >= 400 && status < 500 && code) {
      return reply.status(status).send({ error: { code, message: err.message } })
    }
    // Anything unexpected: log the real cause, show a calm message.
    req.log.error(err)
    return reply.status(status >= 500 ? status : 500).send({ error: { code: 'SERVER_ERROR', message: 'Something went wrong on our end. Please try again in a moment.' } })
  })

  app.register(healthRoutes)
  app.register(registerRoutes)
  app.register(verifyOtpRoutes)
  app.register(loginRoutes)
  app.register(refreshRoutes)
  app.register(logoutRoutes)
  app.register(adminAuthRoutes)
  app.register(adminStatsRoutes)
  app.register(playerMeRoutes)
  app.register(bonusPlayerRoutes)

  app.register(walletBalanceRoutes)
  app.register(walletDepositRoutes)
  app.register(walletWithdrawRoutes)

  app.register(mpesaWebhookRoutes)
  app.register(mpesaC2bRoutes)
  app.register(mtnWebhookRoutes)
  app.register(airtelWebhookRoutes)
  app.register(stubWebhookRoutes)

  app.register(providerBalanceRoutes)
  app.register(providerDebitRoutes)
  app.register(providerCreditRoutes)
  app.register(providerRollbackRoutes)

  app.register(gameLeaderboardRoutes)
  app.register(gameHistoryRoutes)
  app.register(gameConfigRoutes)
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
  app.register(adminEmailConfigRoutes)
  app.register(adminGameSettingsRoutes)
  app.register(adminTaxRoutes)
  app.register(adminWithdrawalRoutes)
  app.register(adminC2bRoutes)
  app.register(adminNotificationRoutes)
  app.register(adminStaffRoutes)
  app.register(adminBonusRoutes)
  app.register(adminCampaignRoutes)
  app.register(adminRolesRoutes)
  app.register(adminMeRoutes)
  app.register(chatRoutes)
  app.register(adminChatRoutes)
  app.register(providerGameRoutes)

  return app
}
