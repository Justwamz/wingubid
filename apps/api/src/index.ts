import { runMigrations } from '@betting/db'
import { buildServer } from './server.js'
import { env } from './env.js'
import { startCron } from './lib/cron.js'
import { Server } from 'socket.io'
import { registerCrashSocket } from './game/crash-socket.js'
import { startCrashLoop } from './game/crash-loop.js'
import { startLotteryLoop } from './game/lottery-loop.js'

async function main() {
  await runMigrations()

  const app = buildServer()
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  app.log.info(`API server listening on port ${env.PORT}`)

  startCron()

  // Fail closed (see server.ts): deny cross-origin when CORS_ORIGIN is unset
  // instead of allowing '*' with credentials.
  const allowedOrigins = (process.env.CORS_ORIGIN ?? '').split(',').map(o => o.trim()).filter(Boolean)
  const io = new Server(app.server, {
    cors: { origin: allowedOrigins.length > 0 ? allowedOrigins : false, credentials: true },
  })
  registerCrashSocket(io)
  startCrashLoop(io)
  startLotteryLoop()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
