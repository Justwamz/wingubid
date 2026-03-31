export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'bet_placed'
  | 'bet_won'
  | 'bet_refunded'
  | 'bonus_credit'
  | 'bonus_wager'
  | 'wager_tax'
  | 'withdrawal_tax'

export type TransactionStatus = 'pending' | 'completed' | 'failed'

export interface Transaction {
  id: string
  wallet_id: string
  player_id: string
  type: TransactionType
  amount: number           // positive = credit, negative = debit
  balance_after: number
  status: TransactionStatus
  reference: string | null  // external payment reference
  idempotency_key: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}
