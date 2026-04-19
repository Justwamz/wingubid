import { pool } from '@betting/db'
import { draw3Numbers, settleTickets, TICKET_PRICES } from '../services/lottery.service.js'

type DrawType = 'hourly' | 'daily' | 'weekly'

let running = false

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getNextDrawTime(drawType: DrawType): Date {
  const now = new Date()
  if (drawType === 'hourly') {
    const next = new Date(now)
    next.setMinutes(0, 0, 0)
    next.setHours(next.getHours() + 1)
    return next
  }
  if (drawType === 'daily') {
    // 20:00 EAT = 17:00 UTC
    const next = new Date(now)
    next.setUTCHours(17, 0, 0, 0)
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
    return next
  }
  // weekly: next Sunday at 17:00 UTC
  const next = new Date(now)
  next.setUTCHours(17, 0, 0, 0)
  const day = next.getUTCDay() // 0 = Sunday
  const daysUntilSunday = day === 0 && next > now ? 0 : (7 - day) % 7 || 7
  next.setUTCDate(next.getUTCDate() + daysUntilSunday)
  return next
}

async function runLoop(drawType: DrawType): Promise<void> {
  while (running) {
    try {
      // Find or create pending draw
      const { rows } = await pool.query<{ id: string; scheduled_at: string }>(
        `SELECT id, scheduled_at FROM lottery_draws
         WHERE draw_type = $1 AND status = 'pending'
         ORDER BY scheduled_at ASC LIMIT 1`,
        [drawType],
      )

      let drawId: string
      let scheduledAt: Date

      if (rows.length > 0) {
        drawId = rows[0].id
        scheduledAt = new Date(rows[0].scheduled_at)
      } else {
        const nextTime = getNextDrawTime(drawType)
        const { rows: inserted } = await pool.query<{ id: string }>(
          `INSERT INTO lottery_draws (draw_type, ticket_price, scheduled_at)
           VALUES ($1, $2, $3) RETURNING id`,
          [drawType, TICKET_PRICES[drawType], nextTime],
        )
        drawId = inserted[0].id
        scheduledAt = nextTime
      }

      const msUntilDraw = Math.max(0, scheduledAt.getTime() - Date.now())
      if (msUntilDraw > 0) await sleep(msUntilDraw)
      if (!running) break

      // Fire the draw
      const winningNumbers = draw3Numbers()
      await pool.query(
        `UPDATE lottery_draws SET status = 'completed', drawn_at = NOW(), winning_numbers = $1 WHERE id = $2`,
        [winningNumbers, drawId],
      )
      console.log(`[lottery] ${drawType} draw fired:`, winningNumbers)

      await settleTickets(drawId, drawType, winningNumbers)
    } catch (err) {
      console.error(`[lottery] ${drawType} loop error`, err)
      await sleep(5000) // back off on error
    }
  }
}

export function startLotteryLoop(): void {
  running = true
  runLoop('hourly').catch(err => console.error('[lottery] hourly loop crashed', err))
  runLoop('daily').catch(err => console.error('[lottery] daily loop crashed', err))
  runLoop('weekly').catch(err => console.error('[lottery] weekly loop crashed', err))
  console.log('[lottery] scheduler started')
}

export function stopLotteryLoop(): void {
  running = false
}
