import { describe, it, expect, vi, afterAll } from 'vitest'

vi.mock('../../middleware/authenticate.js', () => ({
  authenticate: vi.fn(async (req: { playerId: string }) => { req.playerId = 'p1' }),
}))
vi.mock('../../services/lottery.service.js', () => ({
  getUpcomingDraws: vi.fn(async () => []),
  buyTicket: vi.fn(async () => ({ ticketId: 't1', drawId: 'd1', scheduledAt: '2026-01-01T00:00:00Z', ticketPrice: 2000 })),
  getPlayerTickets: vi.fn(async () => []),
}))

import { buildServer } from '../../server.js'
import { buyTicket } from '../../services/lottery.service.js'

describe('POST /games/lottery/tickets', () => {
  const app = buildServer(); afterAll(() => app.close())

  it('rejects fundSource bonus with 422 BONUS_NOT_ALLOWED before touching purchase logic', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/games/lottery/tickets',
      headers: { Authorization: 'Bearer t' },
      payload: { drawType: 'hourly', pickedNumbers: [1, 2, 3], fundSource: 'bonus' },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({
      error: { code: 'BONUS_NOT_ALLOWED', message: 'Bonus funds cannot be used on Wingu Lotto.' },
    })
    expect(buyTicket).not.toHaveBeenCalled()
  })

  it('still allows a normal purchase without fundSource', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/games/lottery/tickets',
      headers: { Authorization: 'Bearer t' },
      payload: { drawType: 'hourly', pickedNumbers: [1, 2, 3] },
    })
    expect(res.statusCode).toBe(201)
    expect(buyTicket).toHaveBeenCalledOnce()
  })
})
