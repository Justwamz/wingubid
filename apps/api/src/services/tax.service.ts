import type { PoolClient } from 'pg'
import { pool } from '@betting/db'

export interface TaxResult {
  taxAmount: number
  effectiveAmount: number
  ratePct: number
}

export async function calculateTax(
  country: string,
  taxType: 'wager_tax' | 'withdrawal_tax',
  grossAmount: number,
): Promise<TaxResult> {
  const { rows } = await pool.query<{ rate: string; enabled: boolean }>(
    `SELECT rate, enabled FROM tax_rules WHERE country = $1 AND tax_type = $2`,
    [country, taxType],
  )

  if (rows.length === 0 || !rows[0].enabled) {
    return { taxAmount: 0, effectiveAmount: grossAmount, ratePct: 0 }
  }

  const ratePct = parseFloat(rows[0].rate)
  const taxAmount = Math.floor((grossAmount * ratePct) / 100)
  return { taxAmount, effectiveAmount: grossAmount - taxAmount, ratePct }
}

export async function recordTax(
  client: PoolClient,
  params: {
    playerId: string
    taxAmount: number
    taxType: 'wager_tax' | 'withdrawal_tax'
    country: string
    transactionId: string
  },
): Promise<void> {
  await client.query(
    `INSERT INTO tax_transactions (player_id, transaction_id, tax_type, country, amount)
     VALUES ($1, $2, $3, $4, $5)`,
    [params.playerId, params.transactionId, params.taxType, params.country, params.taxAmount],
  )
}
