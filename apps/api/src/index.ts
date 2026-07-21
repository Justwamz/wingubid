import { runMigrations } from '@betting/db'
import { buildServer } from './server.js'
import { env } from './env.js'
import { startCron } from './lib/cron.js'
import { Server } from 'socket.io'
import { Redis } from 'ioredis'
import { createAdapter } from '@socket.io/redis-adapter'
import { registerCrashSocket } from './game/crash-socket.js'
import { registerChatSocket } from './game/chat-socket.js'
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

  // Redis adapter so socket rooms (crash ticks, chat) fan out across multiple
  // API instances. Dedicated pub/sub clients, separate from the app command
  // client. Errors are logged, never thrown, so a Redis blip can't crash boot.
  const pubClient = new Redis(env.REDIS_URL)
  const subClient = pubClient.duplicate()
  pubClient.on('error', err => app.log.error(`[socket-redis] pub: ${err.message}`))
  subClient.on('error', err => app.log.error(`[socket-redis] sub: ${err.message}`))
  io.adapter(createAdapter(pubClient, subClient))

  registerCrashSocket(io)
  registerChatSocket(io)
  startCrashLoop(io)
  startLotteryLoop()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
