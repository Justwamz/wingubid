export type RoundStatus = 'waiting' | 'running' | 'crashed'

export interface GameRound {
  id: string
  round_number: number
  server_seed_hash: string  // committed before round
  server_seed: string | null  // revealed after round
  client_seed: string
  crash_point: number | null
  status: RoundStatus
  started_at: string | null
  crashed_at: string | null
  created_at: string
}
