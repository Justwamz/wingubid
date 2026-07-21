import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { authenticateAdmin } from '../../middleware/authenticateAdmin.js'
import {
  getHouseEdges, setHouseEdge, getGamesEnabled, setGameEnabled,
  getRtpMonitorConfig, setRtpMonitorConfig, getGameOrderConfig, setGameOrderConfig,
  ALL_GAMES, type AnyGame,
} from '../../services/game-settings.service.js'
import { getLotteryMargins, getScratchMargin } from '../../services/game-margins.service.js'
import { computeRealizedRtp } from '../../services/rtp-monitor.service.js'
import { invalidateGameOrderCache } from '../../services/game-order.service.js'

// House edge is a percentage; bound it to a sane range so a typo can't make a
// game unplayable or run at a loss.
const edge = z.number().min(0, 'House edge cannot be negative.').max(30, 'House edge cannot exceed 30%.')
const bodySchema = z.object({ crash: edge, mines: edge, dice: edge })

export async function adminGameSettingsRoutes(app: FastifyInstance) {
  app.get('/admin/game-settings', { preHandler: authenticateAdmin }, async (_req, reply) => {
    const rtpConfig = await getRtpMonitorConfig()
    const realizedRtp = await computeRealizedRtp(rtpConfig.windowMinutes)
    return reply.send({
      houseEdge: await getHouseEdges(),
      // Read-only: lotto and scratch margins are structural (fixed prize tables).
      lottery: getLotteryMargins(),
      scratch: getScratchMargin(),
      gamesEnabled: await getGamesEnabled(),
      rtpMonitor: rtpConfig,
      realizedRtp,
      gameOrder: await getGameOrderConfig(),
    })
  })

  app.put('/admin/game-settings', { preHandler: authenticateAdmin }, async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    await setHouseEdge('crash', parsed.data.crash)
    await setHouseEdge('mines', parsed.data.mines)
    await setHouseEdge('dice', parsed.data.dice)
    return reply.send({ houseEdge: await getHouseEdges() })
  })

  // Pause / resume a game.
  app.put('/admin/game-settings/game-enabled', { preHandler: authenticateAdmin }, async (req, reply) => {
    const parsed = z.object({
      game: z.enum(ALL_GAMES as [AnyGame, ...AnyGame[]]),
      enabled: z.boolean(),
    }).safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    await setGameEnabled(parsed.data.game, parsed.data.enabled)
    return reply.send({ gamesEnabled: await getGamesEnabled() })
  })

  // RTP monitor thresholds.
  app.put('/admin/game-settings/rtp-monitor', { preHandler: authenticateAdmin }, async (req, reply) => {
    const g = z.number().positive()
    const parsed = z.object({
      windowMinutes: z.number().int().min(5).max(10080).optional(),
      minBets: z.number().int().min(1).max(100000).optional(),
      reAlertMinutes: z.number().int().min(5).max(1440).optional(),
      warnRtp: z.object({ crash: g, mines: g, dice: g, scratch: g }).partial().optional(),
    }).safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    const cur = await getRtpMonitorConfig()
    await setRtpMonitorConfig({
      windowMinutes: parsed.data.windowMinutes ?? cur.windowMinutes,
      minBets: parsed.data.minBets ?? cur.minBets,
      reAlertMinutes: parsed.data.reAlertMinutes ?? cur.reAlertMinutes,
      warnRtp: { ...cur.warnRtp, ...(parsed.data.warnRtp ?? {}) },
    })
    return reply.send({ rtpMonitor: await getRtpMonitorConfig() })
  })

  // Game-ordering weights / window.
  app.put('/admin/game-settings/game-order', { preHandler: authenticateAdmin }, async (req, reply) => {
    const parsed = z.object({
      windowDays: z.number().int().min(1).max(90).optional(),
      revenueWeight: z.number().min(0).max(1).optional(),
      minStake: z.number().int().min(0).optional(),
    }).safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message } })
    }
    const cur = await getGameOrderConfig()
    await setGameOrderConfig({
      windowDays: parsed.data.windowDays ?? cur.windowDays,
      revenueWeight: parsed.data.revenueWeight ?? cur.revenueWeight,
      minStake: parsed.data.minStake ?? cur.minStake,
    })
    invalidateGameOrderCache()
    return reply.send({ gameOrder: await getGameOrderConfig() })
  })
}
