import { z } from 'zod'
import type { Server, Socket } from 'socket.io'
import { verifyPlayerAccessToken } from '../lib/jwt.js'
import {
  getChatEnabled, getUsername, getActiveBan, getBannedWords, hasProfanity,
  recordStrike, saveMessage, getRecentMessages,
} from '../services/chat.service.js'

// v1: chat lives only on Wingu Crash. Built to extend to more games later.
const GAME = 'crash'
const room = (game: string) => `chat:${game}`

const sendSchema = z.object({ text: z.string().min(1).max(200) })

// Per-player in-memory throttle (socket events aren't covered by the HTTP limiter).
const MIN_INTERVAL_MS = 1500
const BURST_WINDOW_MS = 10_000
const BURST_MAX = 5
const recent = new Map<string, number[]>()

let ioRef: Server | null = null

export function registerChatSocket(io: Server): void {
  ioRef = io
  io.on('connection', async (socket: Socket) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) return
    let playerId: string
    try {
      playerId = verifyPlayerAccessToken(token).sub
    } catch {
      return
    }
    socket.data.playerId = playerId
    socket.join(room(GAME))

    try {
      const [enabled, username, messages] = await Promise.all([
        getChatEnabled(GAME), getUsername(playerId), getRecentMessages(GAME, 50),
      ])
      socket.emit('chat:init', { enabled, username, messages })
    } catch {
      socket.emit('chat:init', { enabled: true, username: null, messages: [] })
    }

    socket.on('chat:send', async (data: unknown) => {
      const parsed = sendSchema.safeParse(data)
      if (!parsed.success) { socket.emit('chat:error', { code: 'VALIDATION_ERROR', message: 'Message must be 1-200 characters.' }); return }
      const text = parsed.data.text.trim()
      if (!text) return

      try {
        if (!(await getChatEnabled(GAME))) { socket.emit('chat:error', { code: 'CHAT_DISABLED', message: 'Chat is paused.' }); return }

        const username = await getUsername(playerId)
        if (!username) { socket.emit('chat:error', { code: 'NO_USERNAME', message: 'Choose a chat name first.' }); return }

        const ban = await getActiveBan(playerId)
        if (ban) { socket.emit('chat:error', { code: 'BANNED', message: banMessage(ban.until) }); return }

        // Rate limit / flood detection.
        const now = Date.now()
        const times = (recent.get(playerId) ?? []).filter(t => t > now - BURST_WINDOW_MS)
        if (times.length >= BURST_MAX) {
          recent.set(playerId, times)
          const r = await recordStrike(playerId, 'spam')
          socket.emit('chat:error', r.banned ? { code: 'BANNED', message: banMessage(r.until?.toISOString() ?? null) } : { code: 'RATE_LIMITED', message: 'You are sending messages too fast.' })
          return
        }
        if (times.length > 0 && now - times[times.length - 1] < MIN_INTERVAL_MS) {
          socket.emit('chat:error', { code: 'RATE_LIMITED', message: 'Slow down a moment.' })
          return
        }

        // Profanity -> block + strike (may auto-ban).
        if (hasProfanity(text, await getBannedWords())) {
          const r = await recordStrike(playerId, 'profanity')
          socket.emit('chat:error', r.banned ? { code: 'BANNED', message: banMessage(r.until?.toISOString() ?? null) } : { code: 'BLOCKED', message: 'That message was blocked.' })
          return
        }

        times.push(now)
        recent.set(playerId, times)
        const message = await saveMessage(GAME, playerId, username, text)
        io.to(room(GAME)).emit('chat:message', message)
      } catch {
        socket.emit('chat:error', { code: 'SERVER_ERROR', message: 'Could not send your message.' })
      }
    })
  })
}

function banMessage(until: string | null): string {
  if (!until) return 'You are permanently muted in chat.'
  return `You are muted until ${new Date(until).toLocaleString('en-KE')}.`
}

// ---- Broadcast helpers for HTTP moderation routes --------------------------

export function broadcastChatDeleted(game: string, id: string): void {
  ioRef?.to(room(game)).emit('chat:deleted', { id })
}

export function broadcastChatEnabled(game: string, enabled: boolean): void {
  ioRef?.to(room(game)).emit(enabled ? 'chat:enabled' : 'chat:disabled', {})
}
