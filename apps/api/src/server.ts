import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import { healthRoutes } from './routes/health.js'

export function buildServer() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  app.register(cors, { origin: true })
  app.register(cookie)
  app.register(healthRoutes)

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
