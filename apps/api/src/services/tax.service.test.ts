import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@betting/db', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@betting/db'
import { calculateTax, recordTax } from './tax.service.js'

const mockQuery = vi.mocked(pool.query)
beforeEach(() => { mockQuery.mockReset() })

describe('calculateTax', () => {
  it('returns correct tax and effective amount when enabled', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ rate: '12.50', enabled: true }],
    } as any)

    const result = await calculateTax('KE', 'wager_tax', 10000)

    expect(result.taxAmount).toBe(1250)
    expect(result.effectiveAmount).toBe(8750)
    expect(result.ratePct).toBe(12.5)
  })

  it('returns zero tax when rule is disabled', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ rate: '0.00', enabled: false }],
    } as any)

    const result = await calculateTax('UG', 'wager_tax', 10000)

    expect(result.taxAmount).toBe(0)
    expect(result.effectiveAmount).toBe(10000)
  })

  it('returns zero tax when no rule exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const result = await calculateTax('XX', 'wager_tax', 10000)

    expect(result.taxAmount).toBe(0)
    expect(result.effectiveAmount).toBe(10000)
  })

  it('floors fractional tax amounts', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ rate: '12.50', enabled: true }],
    } as any)

    // 100 * 12.5 / 100 = 12.5 → floor = 12
    const result = await calculateTax('KE', 'wager_tax', 100)
    expect(result.taxAmount).toBe(12)
    expect(result.effectiveAmount).toBe(88)
  })
})

describe('recordTax', () => {
  it('inserts a tax_transactions row', async () => {
    const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) }

    await recordTax(mockClient as any, {
      playerId: 'player-1',
      taxAmount: 1250,
      taxType: 'wager_tax',
      country: 'KE',
      transactionId: 'tx-1',
    })

    expect(mockClient.query).toHaveBeenCalledOnce()
    const [sql, params] = mockClient.query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('INSERT INTO tax_transactions')
    expect(params).toContain('player-1')
    expect(params).toContain(1250)
    expect(params).toContain('wager_tax')
    expect(params).toContain('tx-1')
  })
})
