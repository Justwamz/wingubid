export type TaxType = 'wager_tax' | 'withdrawal_tax'
export type RemittanceStatus = 'pending_approval' | 'approved' | 'disputed'

export interface TaxRule {
  id: string
  country: string
  tax_type: TaxType
  rate: number   // percentage e.g. 12.50
  enabled: boolean
  updated_at: string
  updated_by: string | null
}

export interface TaxTransaction {
  id: string
  player_id: string
  transaction_id: string
  tax_type: TaxType
  country: string
  amount: number
  created_at: string
}

export interface TaxRemittance {
  id: string
  date: string       // YYYY-MM-DD
  country: string
  tax_type: TaxType
  total_amount: number
  transaction_count: number
  status: RemittanceStatus
  approved_by: string | null
  approved_at: string | null
  disputed_by: string | null
  disputed_at: string | null
  dispute_reason: string | null
  payment_reference: string | null
  created_at: string
}
