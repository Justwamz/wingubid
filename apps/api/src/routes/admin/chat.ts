import { z } from 'zod'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { pool } from '@betting/db'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import { AppError } from '../../lib/errors.js'
import {
  getMessagesForAdmin, deleteMessage, banPlayer, unbanPlayer, listActiveBans,
  listBannedWords, addBannedWord, removeBannedWord, resetUsername,
  getChatEnabled, setChatEnabled, getAutobanConfig, setAutobanConfig,
} from '../../services/chat.service.js'
import { broadcastChatDeleted, broadcastChatEnabled } from '../../game/chat-socket.js'

const GAME = 'crash'
const MODERATOR_ROLES = ['support', 'super_admin']

function requireMod(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!MODERATOR_ROLES.includes(req.adminRole)) {
    reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only Support or Super Admin can moderate chat.' } })
    return false
  }
  return true
}

async function audit(adminId: string, action: string, entityId: string | null, after: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO admin_audit_log (admin_id, action, entity, entity_id, after) VALUES ($1, $2, 'chat', $3, $4::jsonb)`,
    [adminId, action, entityId, JSON.stringify(after ?? {})],
  )
}

export async function adminChatRoutes(app: FastifyInstance) {
  // Read-only listing is available to any admin; mutations require a moderator.
  app.get('/admin/chat/messages', { preHandler: authenticateAdmin }, async (_req, reply) => {
    return reply.send({ messages: await getMessagesForAdmin(GAME, 100) })
  })

  app.get('/admin/chat/bans', { preHandler: authenticateAdmin }, async (_req, reply) => {
    return reply.send({ bans: await listActiveBans() })
  })

  app.get('/admin/chat/banned-words', { preHandler: authenticateAdmin }, async (_req, reply) => {
    return reply.send({ words: await listBannedWords() })
  })

  app.get('/admin/chat/settings', { preHandler: authenticateAdmin }, async (_req, reply) => {
    return reply.send({ enabled: await getChatEnabled(GAME), autoban: await getAutobanConfig() })
  })

  app.post('/admin/chat/messages/:id/delete', { preHandler: authenticateAdmin }, async (req, reply) => {
    if (!requireMod(req, reply)) return
    const { id } = req.params as { id: string }
    const game = await deleteMessage(id, req.adminId)
    if (!game) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Message not found or already deleted.' } })
    broadcastChatDeleted(game, id)
    await audit(req.adminId, 'chat_message_delete', id, { game })
    return reply.send({ ok: true })
  })

  app.post('/admin/chat/ban', { preHandler: authenticateAdmin }, async (req, reply) => {
    if (!requireMod(req, reply)) return
    const parsed = z.object({
      playerId: z.string().uuid(),
      durationHours: z.number().positive().optional(),
      reason: z.string().max(200).optional(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    const until = parsed.data.durationHours ? new Date(Date.now() + parsed.data.durationHours * 3_600_000) : null
    await banPlayer(parsed.data.playerId, until, parsed.data.reason ?? 'Manual ban', req.adminId)
    await audit(req.adminId, 'chat_ban', parsed.data.playerId, { until, reason: parsed.data.reason })
    return reply.send({ ok: true })
  })

  app.post('/admin/chat/unban', { preHandler: authenticateAdmin }, async (req, reply) => {
    if (!requireMod(req, reply)) return
    const parsed = z.object({ playerId: z.string().uuid() }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid player.' } })
    await unbanPlayer(parsed.data.playerId)
    await audit(req.adminId, 'chat_unban', parsed.data.playerId, {})
    return reply.send({ ok: true })
  })

  app.post('/admin/chat/reset-username', { preHandler: authenticateAdmin }, async (req, reply) => {
    if (!requireMod(req, reply)) return
    const parsed = z.object({ playerId: z.string().uuid() }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid player.' } })
    await resetUsername(parsed.data.playerId)
    await audit(req.adminId, 'chat_reset_username', parsed.data.playerId, {})
    return reply.send({ ok: true })
  })

  app.post('/admin/chat/banned-words', { preHandler: authenticateAdmin }, async (req, reply) => {
    if (!requireMod(req, reply)) return
    const parsed = z.object({ word: z.string().min(1).max(50) }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Enter a word.' } })
    try {
      await addBannedWord(parsed.data.word, req.adminId)
    } catch (err) {
      if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
      throw err
    }
    return reply.send({ ok: true })
  })

  app.delete('/admin/chat/banned-words/:word', { preHandler: authenticateAdmin }, async (req, reply) => {
    if (!requireMod(req, reply)) return
    await removeBannedWord((req.params as { word: string }).word)
    return reply.send({ ok: true })
  })

  app.put('/admin/chat/settings', { preHandler: authenticateAdmin }, async (req, reply) => {
    if (!requireMod(req, reply)) return
    const parsed = z.object({
      enabled: z.boolean().optional(),
      windowMin: z.number().int().min(1).max(1440).optional(),
      strikeThreshold: z.number().int().min(1).max(20).optional(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })

    if (parsed.data.enabled !== undefined) {
      await setChatEnabled(GAME, parsed.data.enabled)
      broadcastChatEnabled(GAME, parsed.data.enabled)
    }
    if (parsed.data.windowMin !== undefined || parsed.data.strikeThreshold !== undefined) {
      const cur = await getAutobanConfig()
      await setAutobanConfig({
        windowMin: parsed.data.windowMin ?? cur.windowMin,
        strikeThreshold: parsed.data.strikeThreshold ?? cur.strikeThreshold,
      })
    }
    await audit(req.adminId, 'chat_settings_update', GAME, parsed.data)
    return reply.send({ ok: true })
  })
}
