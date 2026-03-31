import { buildServer } from './server.js'
import { env } from './env.js'

const app = buildServer()

app.listen({ port: env.PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  app.log.info(`API server listening on port ${env.PORT}`)
})
