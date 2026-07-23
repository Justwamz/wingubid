import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../services/auth.service.js', () => ({
  AppError: class AppError extends Error {
    constructor(public code: string, message: string, public statusCode = 400) { super(message) }
  },
  registerPlayer: vi.fn(),
  verifyPlayerOtp: vi.fn(),
  loginPlayer: vi.fn(),
  refreshPlayerTokens: vi.fn(),
  logoutPlayer: vi.fn(),
}))

import { buildServer } from '../../server.js'
import * as authService from '../../services/auth.service.js'

const mockRegister = vi.mocked(authService.registerPlayer)
const mockLogin = vi.mocked(authService.loginPlayer)
const mockVerifyOtp = vi.mocked(authService.verifyPlayerOtp)

describe('POST /auth/register', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('returns 201 on valid input', async () => {
    mockRegister.mockResolvedValueOnce(undefined)

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        phone: '+254700000000',
        name: 'Alice',
        country: 'KE',
        date_of_birth: '1990-01-01',
        password: 'Password1!',
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().message).toContain('OTP')
  })

  it('returns 400 when phone is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Alice', country: 'KE', date_of_birth: '1990-01-01', password: 'Password1!' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 409 when phone is taken', async () => {
    const { AppError } = await import('../../services/auth.service.js')
    mockRegister.mockRejectedValueOnce(new AppError('PHONE_TAKEN', 'Phone taken', 409))

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        phone: '+254700000000',
        name: 'Alice',
        country: 'KE',
        date_of_birth: '1990-01-01',
        password: 'Password1!',
      },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('PHONE_TAKEN')
  })
})

describe('POST /auth/login', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('returns 200 with access_token on valid credentials', async () => {
    mockLogin.mockResolvedValueOnce({ accessToken: 'tok', refreshToken: 'ref' })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { phone: '+254700000000', password: 'Password1!' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().access_token).toBe('tok')
  })
})

describe('rate limiting', () => {
  const app = buildServer()
  afterAll(() => app.close())

  it('returns 429 TOO_MANY_REQUESTS on the 11th /auth/login request from the same IP within the window', async () => {
    mockLogin.mockResolvedValue({ accessToken: 'tok', refreshToken: 'ref' })

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-forwarded-for': '203.0.113.10' },
        payload: { phone: '+254700000000', password: 'Password1!' },
      })
      expect(res.statusCode).toBe(200)
    }

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'x-forwarded-for': '203.0.113.10' },
      payload: { phone: '+254700000000', password: 'Password1!' },
    })
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe('TOO_MANY_REQUESTS')
  })

  it('returns 429 TOO_MANY_REQUESTS on the 11th /auth/verify-otp request from the same IP within the window', async () => {
    mockVerifyOtp.mockResolvedValue({ accessToken: 'tok', refreshToken: 'ref' })

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/verify-otp',
        headers: { 'x-forwarded-for': '203.0.113.11' },
        payload: { phone: '+254700000000', code: '123456' },
      })
      expect(res.statusCode).toBe(200)
    }

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-otp',
      headers: { 'x-forwarded-for': '203.0.113.11' },
      payload: { phone: '+254700000000', code: '123456' },
    })
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe('TOO_MANY_REQUESTS')
  })
})
