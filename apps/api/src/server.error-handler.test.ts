import { describe, it, expect, afterAll } from 'vitest'
import { buildServer } from './server.js'
import { AppError } from './lib/errors.js'

describe('reconciled error handler', () => {
  const app = buildServer()
  afterAll(() => app.close())

  // Ad-hoc routes registered directly on the built (pre-listen) app instance
  // so we can exercise the error handler without a real feature route.
  app.get('/__boom', () => {
    throw new Error('boom')
  })
  app.get('/__app-error', () => {
    throw new AppError('X_CODE', 'friendly', 422)
  })

  it('renders unexpected errors as a calm 500 without leaking the raw message', async () => {
    const res = await app.inject({ method: 'GET', url: '/__boom' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({
      error: { code: 'SERVER_ERROR', message: 'Something went wrong on our end. Please try again in a moment.' },
    })
  })

  it('renders AppError as its own friendly code/message/status', async () => {
    const res = await app.inject({ method: 'GET', url: '/__app-error' })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: { code: 'X_CODE', message: 'friendly' } })
  })
})
