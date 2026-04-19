import { randomBytes } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { hashPassword } from '../../lib/hash.js'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(8)
  return Array.from(bytes).map(b => chars[b % chars.length]).join('')
}

export async function adminPlayersRoutes(app: FastifyInstance) {
  app.get('/admin/players', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const { rows } = await pool.query<{
      id: string; name: string; phone: string; country: string
      balance: string; created_at: string
    }>(
      `SELECT p.id, p.name, p.phone, p.country, p.created_at,
              COALESCE(w.balance, 0) AS balance
       FROM players p
       LEFT JOIN wallets w ON w.player_id = p.id
       ORDER BY p.created_at DESC`,
    )

    return reply.send({
      players: rows.map(r => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        country: r.country,
        balance: Number(r.balance),
        createdAt: r.created_at,
      })),
    })
  })

  app.post('/admin/players/:id/reset-password', { preHandler: authenticateAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const { rows } = await pool.query<{ id: string; phone: string; name: string }>(
      `SELECT id, phone, name FROM players WHERE id = $1`,
      [id],
    )
    if (rows.length === 0) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Player not found' } })
    }

    const tempPassword = generateTempPassword()
    const passwordHash = await hashPassword(tempPassword)

    await pool.query(
      `UPDATE players SET password_hash = $1 WHERE id = $2`,
      [passwordHash, id],
    )

    console.log(
      `[SMS STUB] To: ${rows[0].phone} | Msg: Your WinguBet temporary password is ${tempPassword}. Please change it after logging in.`,
    )

    return reply.send({ tempPassword })
  })
}
