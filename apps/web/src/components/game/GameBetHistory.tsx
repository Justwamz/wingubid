'use client'
import { BetHistory } from '@/components/game/BetHistory'
import { useCoreBetHistory } from '@/lib/useBetHistory'

// Per-game bet-history panel for the bets-backed games (crash / mines / dice).
// Pass a changing `refreshKey` to reload after a new bet is placed.
export function GameBetHistory({
  game,
  title = 'Your Bets',
  refreshKey = 0,
}: {
  game: 'crash' | 'mines' | 'dice'
  title?: string
  refreshKey?: number
}) {
  const { entries, loading, error } = useCoreBetHistory(game, 10, refreshKey)
  return <BetHistory title={title} entries={entries} loading={loading} error={error} />
}
