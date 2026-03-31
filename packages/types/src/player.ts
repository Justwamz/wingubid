export type PlayerStatus = 'active' | 'suspended' | 'self_excluded'

export interface Player {
  id: string
  phone: string
  name: string
  country: string        // ISO 3166-1 alpha-2 e.g. 'KE'
  currency: string       // ISO 4217 e.g. 'KES'
  date_of_birth: string  // YYYY-MM-DD
  status: PlayerStatus
  self_excluded_until: string | null
  created_at: string
}

export interface CreatePlayerInput {
  phone: string
  name: string
  country: string
  currency: string
  date_of_birth: string
  password: string
}
