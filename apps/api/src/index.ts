import { runMigrations } from '@betting/db'
import { buildServer } from './server.js'
import { env } from './env.js'

async function main() {
  await runMigrations()

  const app = buildServer()
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  app.log.info(`API server listening on port ${env.PORT}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
