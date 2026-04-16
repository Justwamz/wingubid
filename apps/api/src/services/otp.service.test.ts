import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the db pool before importing the service
vi.mock('@betting/db', () => ({
  pool: { query: vi.fn() },
}))

// Mock bcrypt so tests are fast
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (val: string) => `hashed:${val}`),
    compare: vi.fn(async (plain: string, hash: string) => hash === `hashed:${plain}`),
  },
}))

import { pool } from '@betting/db'
import { generateOtp, verifyOtp } from './otp.service.js'

const mockQuery = vi.mocked(pool.query)

beforeEach(() => {
  mockQuery.mockReset()
})

describe('generateOtp', () => {
  it('inserts a hashed OTP and returns the plaintext code', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)

    const code = await generateOtp('+254700000000', 'registration')

    expect(code).toMatch(/^\d{6}$/)
    expect(mockQuery).toHaveBeenCalledOnce()
    const [sql, params] = mockQuery.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('INSERT INTO otp_codes')
    expect(params[0]).toBe('+254700000000')
    expect(params[2]).toBe('registration')
  })
})

describe('verifyOtp', () => {
  it('returns true and marks OTP used when code matches', async () => {
    // First query: SELECT unexpired, unused OTP
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'otp-uuid', code_hash: 'hashed:123456' }],
    } as any)
    // Second query: UPDATE used_at
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)

    const result = await verifyOtp('+254700000000', '123456', 'registration')
    expect(result).toBe(true)
    const [updateSql] = mockQuery.mock.calls[1] as unknown as [string, unknown[]]
    expect(updateSql).toContain('UPDATE otp_codes')
  })

  it('returns false when no matching OTP exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    const result = await verifyOtp('+254700000000', '000000', 'registration')
    expect(result).toBe(false)
  })
})
