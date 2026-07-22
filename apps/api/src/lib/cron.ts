import cron from 'node-cron'
import { pool } from '@betting/db'
import { runRtpMonitor } from '../services/rtp-monitor.service.js'
import { sweepExpiredBonuses } from '../services/wallet.service.js'

async function runDailyReconciliation(): Promise<void> {
  console.log('[cron] Starting daily tax reconciliation...')

  // Get all countries that have at least one enabled tax rule
  const { rows: countries } = await pool.query<{ country: string }>(
    `SELECT DISTINCT country FROM tax_rules WHERE enabled = true`,
  )

  for (const { country } of countries) {
    // Skip if already reconciled today
    const { rows: existing } = await pool.query(
      `SELECT id FROM ledger_closes WHERE date = CURRENT_DATE AND country = $1`,
      [country],
    )
    if (existing.length > 0) {
      console.log(`[cron] ${country}: already reconciled today, skipping`)
      continue
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Aggregate tax_transactions for today by tax_type
      const { rows: aggregates } = await client.query<{
        tax_type: string
        total_amount: string
        transaction_count: string
      }>(
        `SELECT tax_type,
                SUM(amount) AS total_amount,
                COUNT(*) AS transaction_count
         FROM tax_transactions
         WHERE country = $1
           AND created_at >= CURRENT_DATE AT TIME ZONE 'Africa/Nairobi'
           AND created_at < (CURRENT_DATE + INTERVAL '1 day') AT TIME ZONE 'Africa/Nairobi'
         GROUP BY tax_type`,
        [country],
      )

      for (const agg of aggregates) {
        await client.query(
          `INSERT INTO tax_remittances
             (date, country, tax_type, total_amount, transaction_count, status)
           VALUES (CURRENT_DATE, $1, $2, $3, $4, 'pending_approval')
           ON CONFLICT DO NOTHING`,
          [country, agg.tax_type, agg.total_amount, agg.transaction_count],
        )
      }

      await client.query(
        `INSERT INTO ledger_closes (date, country, closed_by)
         VALUES (CURRENT_DATE, $1, 'system')`,
        [country],
      )

      await client.query('COMMIT')
      console.log(`[cron] ${country}: reconciliation complete (${aggregates.length} tax types)`)
    } catch (err) {
      await client.query('ROLLBACK')
      console.error(`[cron] ${country}: reconciliation failed`, err)
    } finally {
      client.release()
    }
  }

  console.log('[cron] Daily tax reconciliation done.')
}

export function startCron(): void {
  // 21:00 UTC = midnight EAT (UTC+3)
  cron.schedule('0 21 * * *', () => {
    runDailyReconciliation().catch(err => {
      console.error('[cron] Unhandled reconciliation error', err)
    })
  })
  console.log('[cron] Daily tax reconciliation scheduled at 21:00 UTC')

  // RTP risk monitor: warn-only, every 5 minutes.
  cron.schedule('*/5 * * * *', () => {
    runRtpMonitor().catch(err => console.error('[cron] RTP monitor error', err))
  })
  console.log('[cron] RTP monitor scheduled every 5 minutes')

  // Expired bonus sweep: forfeit active grants past expires_at, every 15 minutes.
  cron.schedule('*/15 * * * *', () => {
    sweepExpiredBonuses().catch(err => console.error('[cron] Bonus expiry sweep error', err))
  })
  console.log('[cron] Bonus expiry sweep scheduled every 15 minutes')
}
