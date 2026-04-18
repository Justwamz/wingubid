import jwt from 'jsonwebtoken'
import { env } from '../env.js'

export interface PlayerAccessPayload {
  sub: string
  type: 'player_access'
  iat: number
  exp: number
}

export interface AdminAccessPayload {
  sub: string
  role: string
  type: 'admin_access'
  iat: number
  exp: number
}

export function signPlayerAccessToken(playerId: string): string {
  return jwt.sign({ sub: playerId, type: 'player_access' }, env.JWT_SECRET, { expiresIn: '24h' })
}

export function verifyPlayerAccessToken(token: string): PlayerAccessPayload {
  return jwt.verify(token, env.JWT_SECRET) as PlayerAccessPayload
}

export function signAdminAccessToken(adminId: string, role: string): string {
  return jwt.sign({ sub: adminId, role, type: 'admin_access' }, env.ADMIN_JWT_SECRET, { expiresIn: '4h' })
}

export function verifyAdminAccessToken(token: string): AdminAccessPayload {
  const payload = jwt.verify(token, env.ADMIN_JWT_SECRET) as AdminAccessPayload
  if (payload.type !== 'admin_access') throw new Error('Not an admin token')
  return payload
}
