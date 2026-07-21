import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))
vi.mock('../lib/hash.js', () => ({ verifyPassword: vi.fn() }))
vi.mock('./ldap-config.service.js', () => ({ getLdapConfig: vi.fn() }))
vi.mock('../lib/ldap-auth.js', () => ({ ldapAuthenticate: vi.fn() }))

import { pool } from '@betting/db'
import { verifyPassword } from '../lib/hash.js'
import { getLdapConfig } from './ldap-config.service.js'
import { ldapAuthenticate } from '../lib/ldap-auth.js'
import { authenticateStaff } from './staff-auth.service.js'

const mockQuery = vi.mocked(pool.query)
const mockVerify = vi.mocked(verifyPassword)
const mockLdapCfg = vi.mocked(getLdapConfig)
const mockLdapAuth = vi.mocked(ldapAuthenticate)

const localRow = {
  id: 'u1', name: 'Jane', email: 'jane@x.com', role: 'finance',
  status: 'active', password_hash: 'h', auth_provider: 'local', must_change_password: false,
}

beforeEach(() => { mockQuery.mockReset(); mockVerify.mockReset(); mockLdapCfg.mockReset(); mockLdapAuth.mockReset() })

describe('authenticateStaff (local)', () => {
  it('succeeds with a valid password', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [localRow] } as never)
    mockVerify.mockResolvedValueOnce(true)
    const r = await authenticateStaff('jane@x.com', 'pw')
    expect(r.id).toBe('u1')
    expect(r.role).toBe('finance')
    expect(mockLdapAuth).not.toHaveBeenCalled()
  })

  it('rejects a bad password', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [localRow] } as never)
    mockVerify.mockResolvedValueOnce(false)
    await expect(authenticateStaff('jane@x.com', 'bad')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('rejects a suspended account', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...localRow, status: 'suspended' }] } as never)
    mockVerify.mockResolvedValueOnce(true)
    await expect(authenticateStaff('jane@x.com', 'pw')).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' })
  })
})

describe('authenticateStaff (ldap seam)', () => {
  it('uses the ldap module when provider=ldap and enabled, mapping group->role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...localRow, auth_provider: 'ldap' }] } as never)
    mockLdapCfg.mockResolvedValueOnce({ enabled: true, groupRoleMap: { 'cn=Finance': 'finance' } } as never)
    mockLdapAuth.mockResolvedValueOnce({ dn: 'd', email: 'jane@x.com', name: 'Jane', groups: ['cn=Finance'] } as never)
    const r = await authenticateStaff('jane@x.com', 'pw')
    expect(mockLdapAuth).toHaveBeenCalled()
    expect(r.role).toBe('finance')
  })
})
