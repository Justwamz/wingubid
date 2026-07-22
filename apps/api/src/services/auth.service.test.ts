import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock client used for transaction tests (registerPlayer uses pool.connect())
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}

vi.mock('@betting/db', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(async () => mockClient),
  },
}))
vi.mock('./otp.service.js', () => ({
  generateOtp: vi.fn(async () => '123456'),
  verifyOtp: vi.fn(async () => true),
}))
vi.mock('./sms.service.js', () => ({ sendSms: vi.fn(async () => {}) }))
vi.mock('../lib/hash.js', () => ({
  hashPassword: vi.fn(async (p: string) => `hash:${p}`),
  verifyPassword: vi.fn(async (plain: string, hash: string) => hash === `hash:${plain}`),
}))
vi.mock('../lib/jwt.js', () => ({
  signPlayerAccessToken: vi.fn((id: string) => `access:${id}`),
}))
// These tests exercise the OTP/verification flow, so run with SMS enabled
// (the gate now lives in the sms-config service) and demo mode off.
vi.mock('../env.js', () => ({ env: { SMS_ENABLED: true, DEMO_MODE: false } }))
vi.mock('./sms-config.service.js', () => ({ smsEnabled: vi.fn(async () => true) }))

import { pool } from '@betting/db'
import {
  registerPlayer,
  verifyPlayerOtp,
  loginPlayer,
} from './auth.service.js'

const mockPoolQuery = vi.mocked(pool.query)
const mockClientQuery = vi.mocked(mockClient.query)

beforeEach(() => {
  mockPoolQuery.mockReset()
  mockClientQuery.mockReset()
  mockClient.release.mockReset()
})

describe('registerPlayer', () => {
  it('inserts a player and wallet then sends OTP', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] } as any)              // BEGIN
      .mockResolvedValueOnce({ rows: [] } as any)              // phone check - not taken
      .mockResolvedValueOnce({ rows: [{ id: 'new-id' }] } as any) // insert player
      .mockResolvedValueOnce({ rows: [] } as any)              // insert wallet
      .mockResolvedValueOnce({ rows: [] } as any)              // COMMIT

    await registerPlayer({
      phone: '+254700000000',
      name: 'Alice',
      country: 'KE',
      currency: 'KES',
      date_of_birth: '1990-01-01',
      password: 'Password1!',
    })

    expect(mockClientQuery).toHaveBeenCalledTimes(5)
    expect(mockClient.release).toHaveBeenCalledOnce()
  })

  it('records a signup player_signals row on the pool, after commit, with ip + deviceId', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] } as any)              // BEGIN
      .mockResolvedValueOnce({ rows: [] } as any)              // phone check - not taken
      .mockResolvedValueOnce({ rows: [{ id: 'new-id' }] } as any) // insert player
      .mockResolvedValueOnce({ rows: [] } as any)              // insert wallet
      .mockResolvedValueOnce({ rows: [] } as any)              // COMMIT
    mockPoolQuery.mockResolvedValueOnce({ rows: [] } as any)   // insert player_signals (post-commit)

    await registerPlayer({
      phone: '+254700000000',
      name: 'Alice',
      country: 'KE',
      currency: 'KES',
      date_of_birth: '1990-01-01',
      password: 'Password1!',
      ip: '41.90.12.34',
      deviceId: 'device-abc-123',
    })

    // The transaction itself never sees the signal insert.
    expect(mockClientQuery).toHaveBeenCalledTimes(5)
    expect(mockClientQuery.mock.calls.some(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO player_signals'),
    )).toBe(false)

    const signalCall = mockPoolQuery.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO player_signals'),
    )
    expect(signalCall).toBeDefined()
    expect(signalCall![0]).toContain("'signup'")
    expect(signalCall![1]).toEqual(['new-id', '41.90.12.34', 'device-abc-123'])
  })

  it('does not write a player_signals row when ip and deviceId are absent', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] } as any)              // BEGIN
      .mockResolvedValueOnce({ rows: [] } as any)              // phone check - not taken
      .mockResolvedValueOnce({ rows: [{ id: 'new-id' }] } as any) // insert player
      .mockResolvedValueOnce({ rows: [] } as any)              // insert wallet
      .mockResolvedValueOnce({ rows: [] } as any)              // COMMIT

    await registerPlayer({
      phone: '+254700000000',
      name: 'Alice',
      country: 'KE',
      currency: 'KES',
      date_of_birth: '1990-01-01',
      password: 'Password1!',
    })

    expect(mockClientQuery).toHaveBeenCalledTimes(5)
    const signalCall = mockPoolQuery.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO player_signals'),
    )
    expect(signalCall).toBeUndefined()
  })

  it('stores a null ip (but still registers successfully) when req.ip is not a valid IP', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] } as any)              // BEGIN
      .mockResolvedValueOnce({ rows: [] } as any)              // phone check - not taken
      .mockResolvedValueOnce({ rows: [{ id: 'new-id' }] } as any) // insert player
      .mockResolvedValueOnce({ rows: [] } as any)              // insert wallet
      .mockResolvedValueOnce({ rows: [] } as any)              // COMMIT
    mockPoolQuery.mockResolvedValueOnce({ rows: [] } as any)   // insert player_signals (post-commit)

    // Registration must succeed (not throw/500) regardless of a garbage req.ip.
    // smsOn is mocked true in this file, so a successful register resolves to
    // null (OTP path) rather than tokens - the important thing is it resolves.
    await expect(
      registerPlayer({
        phone: '+254700000000',
        name: 'Alice',
        country: 'KE',
        currency: 'KES',
        date_of_birth: '1990-01-01',
        password: 'Password1!',
        ip: 'not-an-ip',
        deviceId: 'device-abc-123',
      }),
    ).resolves.toBeNull()

    const signalCall = mockPoolQuery.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO player_signals'),
    )
    expect(signalCall).toBeDefined()
    expect(signalCall![1]).toEqual(['new-id', null, 'device-abc-123'])
  })

  it('still succeeds even if the post-commit signal insert throws', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] } as any)              // BEGIN
      .mockResolvedValueOnce({ rows: [] } as any)              // phone check - not taken
      .mockResolvedValueOnce({ rows: [{ id: 'new-id' }] } as any) // insert player
      .mockResolvedValueOnce({ rows: [] } as any)              // insert wallet
      .mockResolvedValueOnce({ rows: [] } as any)              // COMMIT
    mockPoolQuery.mockRejectedValueOnce(new Error('boom'))     // signal insert fails

    await expect(
      registerPlayer({
        phone: '+254700000000',
        name: 'Alice',
        country: 'KE',
        currency: 'KES',
        date_of_birth: '1990-01-01',
        password: 'Password1!',
        ip: '41.90.12.34',
        deviceId: 'device-abc-123',
      }),
    ).resolves.toBeNull()
  })

  it('throws PHONE_TAKEN when phone already exists', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] } as any)              // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'existing' }] } as any) // phone taken
      .mockResolvedValueOnce({ rows: [] } as any)              // ROLLBACK

    await expect(
      registerPlayer({
        phone: '+254700000000',
        name: 'Alice',
        country: 'KE',
        currency: 'KES',
        date_of_birth: '1990-01-01',
        password: 'Password1!',
      }),
    ).rejects.toMatchObject({ code: 'PHONE_TAKEN' })
  })
})

describe('verifyPlayerOtp', () => {
  it('sets phone_verified_at and returns tokens', async () => {
    // verifyOtp is mocked to return true (module-level mock above)
    // UPDATE players SET phone_verified_at RETURNING id
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] } as any)
    // INSERT INTO refresh_tokens
    mockPoolQuery.mockResolvedValueOnce({ rows: [] } as any)

    const { accessToken } = await verifyPlayerOtp('+254700000000', '123456')
    expect(accessToken).toBe('access:p1')
  })
})

describe('loginPlayer', () => {
  it('returns tokens for valid credentials', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 'p1',
        password_hash: 'hash:Password1!',
        phone_verified_at: new Date(),
        status: 'active',
      }],
    } as any)
    mockPoolQuery.mockResolvedValueOnce({ rows: [] } as any) // insert refresh token

    const { accessToken } = await loginPlayer('+254700000000', 'Password1!')
    expect(accessToken).toBe('access:p1')
  })

  it('throws INVALID_CREDENTIALS for wrong password', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 'p1',
        password_hash: 'hash:correct',
        phone_verified_at: new Date(),
        status: 'active',
      }],
    } as any)

    await expect(loginPlayer('+254700000000', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    })
  })

  it('throws PHONE_NOT_VERIFIED when OTP was never completed', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{
        id: 'p1',
        password_hash: 'hash:Password1!',
        phone_verified_at: null,
        status: 'active',
      }],
    } as any)

    await expect(loginPlayer('+254700000000', 'Password1!')).rejects.toMatchObject({
      code: 'PHONE_NOT_VERIFIED',
    })
  })
})
