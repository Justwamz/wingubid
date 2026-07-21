import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/permissions.service.js', () => ({
  getPermissionsForAdmin: vi.fn(),
}))

import { getPermissionsForAdmin } from '../services/permissions.service.js'
import { requirePermission } from './requirePermission.js'

const mockGet = vi.mocked(getPermissionsForAdmin)

function fakeReply() {
  const r: any = { statusCode: 0, body: null }
  r.status = (c: number) => { r.statusCode = c; return r }
  r.send = (b: unknown) => { r.body = b; return r }
  return r
}

describe('requirePermission', () => {
  beforeEach(() => mockGet.mockReset())

  it('passes when the admin has the key', async () => {
    mockGet.mockResolvedValueOnce(new Set(['staff.view']))
    const reply = fakeReply()
    await requirePermission('staff.view')({ adminId: 'a1' } as any, reply)
    expect(reply.statusCode).toBe(0)
  })

  it('403s when the admin lacks the key', async () => {
    mockGet.mockResolvedValueOnce(new Set(['stats.view']))
    const reply = fakeReply()
    await requirePermission('staff.view')({ adminId: 'a1' } as any, reply)
    expect(reply.statusCode).toBe(403)
    expect(reply.body.error.code).toBe('FORBIDDEN')
  })
})
