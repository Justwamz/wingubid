import { runMigrations } from '@betting/db'
import { buildServer } from './server.js'
import { env } from './env.js'
import { startCron } from './lib/cron.js'
import { Server } from 'socket.io'
import { registerCrashSocket } from './game/crash-socket.js'
import { startCrashLoop } from './game/crash-loop.js'

async function main() {
  await runMigrations()

  const app = buildServer()
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  app.log.info(`API server listening on port ${env.PORT}`)

  startCron()

  const io = new Server(app.server, {
    cors: { origin: process.env.CORS_ORIGIN ?? '*', credentials: true },
  })
  registerCrashSocket(io)
  startCrashLoop(io)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
