import { describe, it, expect } from 'vitest'
import {
  signPlayerAccessToken,
  verifyPlayerAccessToken,
  signAdminAccessToken,
  verifyAdminAccessToken,
} from './jwt.js'

describe('player tokens', () => {
  it('round-trips a player access token', () => {
    const token = signPlayerAccessToken('player-uuid-123')
    const payload = verifyPlayerAccessToken(token)
    expect(payload.sub).toBe('player-uuid-123')
    expect(payload.type).toBe('player_access')
  })

  it('throws on tampered player token', () => {
    const token = signPlayerAccessToken('player-uuid-123')
    expect(() => verifyPlayerAccessToken(token + 'x')).toThrow()
  })
})

describe('admin tokens', () => {
  it('round-trips an admin access token', () => {
    const token = signAdminAccessToken('admin-uuid-456', 'finance')
    const payload = verifyAdminAccessToken(token)
    expect(payload.sub).toBe('admin-uuid-456')
    expect(payload.role).toBe('finance')
    expect(payload.type).toBe('admin_access')
  })

  it('rejects player token as admin token', () => {
    const playerToken = signPlayerAccessToken('player-uuid-123')
    expect(() => verifyAdminAccessToken(playerToken)).toThrow()
  })
})
