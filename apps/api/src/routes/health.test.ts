import { describe, it, expect, afterAll } from 'vitest'
import { buildServer } from '../server.js'

describe('GET /health', () => {
  const app = buildServer()

  afterAll(() => app.close())

  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
