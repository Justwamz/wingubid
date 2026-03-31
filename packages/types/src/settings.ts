export interface CountrySettings {
  country: string
  currency: string
  min_deposit: number
  max_deposit: number | null
  min_withdrawal: number
  max_withdrawal: number | null
  daily_withdrawal_limit: number | null
  remittance_cron: string
  tax_authority_bank_account: Record<string, string> | null
  remittance_enabled: boolean
  updated_at: string
}

export interface ProviderGame {
  id: string
  provider: string   // pragmatic_play | habanero | kiron | betgames
  game_id: string
  name: string
  game_type: 'slot' | 'virtual_sport'
  enabled: boolean
  metadata: Record<string, unknown> | null
}

export interface BonusConfig {
  welcome_bonus_rate: number    // e.g. 100 for 100% match
  welcome_bonus_cap: number     // max bonus in smallest currency unit
  wagering_multiplier: number   // e.g. 10 for 10x wagering requirement
}
