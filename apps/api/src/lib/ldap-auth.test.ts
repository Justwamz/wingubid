import { describe, it, expect, vi, beforeEach } from 'vitest'

const bind = vi.fn()
const search = vi.fn()
const unbind = vi.fn()

vi.mock('ldapts', () => ({
  Client: vi.fn().mockImplementation(() => ({ bind, search, unbind })),
}))

import { ldapAuthenticate, DEFAULT_LDAP_CONFIG, type LdapConfig } from './ldap-auth.js'

const cfg: LdapConfig = {
  ...DEFAULT_LDAP_CONFIG,
  enabled: true,
  host: 'ldap.example.com',
  baseDN: 'dc=example,dc=com',
  bindDN: 'cn=svc,dc=example,dc=com',
  bindPassword: 'svcpw',
  userFilter: '(mail={{login}})',
}

beforeEach(() => { bind.mockReset(); search.mockReset(); unbind.mockReset() })

describe('ldapAuthenticate', () => {
  it('returns profile + groups on success', async () => {
    bind.mockResolvedValue(undefined) // service bind + user bind both succeed
    search.mockResolvedValue({ searchEntries: [{
      dn: 'cn=jane,dc=example,dc=com', mail: 'jane@example.com', cn: 'Jane',
      memberOf: ['cn=Finance,dc=example,dc=com'],
    }] })
    const p = await ldapAuthenticate(cfg, 'jane@example.com', 'userpw')
    expect(p.email).toBe('jane@example.com')
    expect(p.groups).toContain('cn=Finance,dc=example,dc=com')
    expect(unbind).toHaveBeenCalled()
  })

  it('throws LDAP_USER_NOT_FOUND when the search is empty', async () => {
    bind.mockResolvedValue(undefined)
    search.mockResolvedValue({ searchEntries: [] })
    await expect(ldapAuthenticate(cfg, 'ghost@example.com', 'x'))
      .rejects.toMatchObject({ code: 'LDAP_USER_NOT_FOUND' })
    expect(unbind).toHaveBeenCalled()
  })

  it('escapes RFC 4515 special characters in the search filter', async () => {
    bind.mockResolvedValue(undefined)
    search.mockResolvedValue({ searchEntries: [{ dn: 'cn=x,dc=example,dc=com', mail: 'x@example.com', cn: 'X', memberOf: [] }] })
    await ldapAuthenticate(cfg, '*)(uid=*', 'pw')
    const filterArg = (search.mock.calls[0][1] as { filter: string }).filter
    expect(filterArg).toBe('(mail=\\2a\\29\\28uid=\\2a)')
  })

  it('throws LDAP_AUTH_FAILED when the user bind rejects', async () => {
    bind.mockResolvedValueOnce(undefined) // service bind ok
    search.mockResolvedValue({ searchEntries: [{ dn: 'cn=jane,dc=example,dc=com', mail: 'jane@example.com', cn: 'Jane', memberOf: [] }] })
    bind.mockRejectedValueOnce(new Error('invalid credentials')) // user bind fails
    await expect(ldapAuthenticate(cfg, 'jane@example.com', 'wrong'))
      .rejects.toMatchObject({ code: 'LDAP_AUTH_FAILED' })
    expect(unbind).toHaveBeenCalled()
  })
})
