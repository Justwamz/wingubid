export interface Wallet {
  id: string
  player_id: string
  currency: string
  balance: number          // integer, smallest unit (e.g. cents)
  bonus_balance: number
  locked_balance: number
}
