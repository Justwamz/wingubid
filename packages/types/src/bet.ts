export type BetStatus = 'active' | 'won' | 'lost' | 'refunded'
export type GameType = 'crash' | 'slot' | 'virtual_sport'

export interface Bet {
  id: string
  player_id: string
  wallet_id: string
  round_id: string | null  // null for provider (slot/virtual) bets
  game_type: GameType
  gross_stake: number      // amount player entered
  wager_tax: number        // tax deducted from gross_stake
  effective_stake: number  // gross_stake - wager_tax
  auto_cashout_at: number | null
  cashout_multiplier: number | null
  winnings: number | null
  status: BetStatus
  settled_at: string | null
  created_at: string
}
