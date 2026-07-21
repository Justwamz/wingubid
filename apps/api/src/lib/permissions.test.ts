import { describe, it, expect } from 'vitest'
import { PERMISSION_CATALOG, ALL_PERMISSION_KEYS, isValidPermission, SUPER_ADMIN_ROLE_KEY } from './permissions.js'

describe('permission catalog', () => {
  it('exposes grouped areas with at least staff and roles', () => {
    const areas = PERMISSION_CATALOG.map(g => g.area)
    expect(areas).toContain('staff')
    expect(areas).toContain('roles')
    expect(areas).toContain('withdrawals')
  })

  it('ALL_PERMISSION_KEYS is the flattened, unique set of every key', () => {
    const flat = PERMISSION_CATALOG.flatMap(g => g.permissions.map(p => p.key))
    expect(ALL_PERMISSION_KEYS).toEqual(flat)
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length)
  })

  it('validates keys against the catalog', () => {
    expect(isValidPermission('withdrawals.approve')).toBe(true)
    expect(isValidPermission('not.a.key')).toBe(false)
  })

  it('exports the super admin role key', () => {
    expect(SUPER_ADMIN_ROLE_KEY).toBe('super_admin')
  })
})
