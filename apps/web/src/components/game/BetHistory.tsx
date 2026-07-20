'use client'

export interface BetHistoryEntry {
  id: string
  game?: string            // shown only when showGame is true
  stake: number            // cents
  status: string           // 'won' | 'lost' | 'active' | 'pending' | 'refunded'
  payout: number           // cents (0 when not won)
  multiplier?: number | null
  createdAt: string
}

const GAME_LABELS: Record<string, string> = {
  crash: 'Crash',
  mines: 'Mines',
  dice: 'Dice',
  lotto: 'Lotto',
  scratch: 'Scratch',
}

function gameLabel(game?: string) {
  if (!game) return ''
  return GAME_LABELS[game] ?? game
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return 'now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.round(hrs / 24)
  return `${days}d`
}

function OutcomeBadge({ status }: { status: string }) {
  if (status === 'won') return <span className="text-accent-cyan font-bold">WON</span>
  if (status === 'lost') return <span className="text-warning-coral font-bold">LOST</span>
  if (status === 'refunded') return <span className="text-gray-400 font-bold">REFUND</span>
  // active / pending / anything else
  return <span className="text-gray-400 font-bold">{status.toUpperCase()}</span>
}

interface Props {
  entries: BetHistoryEntry[]
  title?: string
  loading?: boolean
  error?: boolean
  showGame?: boolean
  emptyText?: string
}

export function BetHistory({
  entries,
  title = 'Your Bets',
  loading,
  error,
  showGame,
  emptyText = 'No bets yet.',
}: Props) {
  return (
    <div className="bg-game-card border border-game-border rounded-xl p-4 space-y-2">
      <p className="text-gray-400 text-xs font-mono font-bold uppercase tracking-widest">{title}</p>

      {loading ? (
        <p className="text-gray-500 text-sm text-center py-4">Loading…</p>
      ) : error ? (
        <p className="text-warning-coral text-sm text-center py-4">Could not load history.</p>
      ) : entries.length === 0 ? (
        <p className="text-gray-600 text-sm text-center py-4">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs">
                {showGame && <th scope="col" className="text-left py-1 pr-2">Game</th>}
                <th scope="col" className="text-left py-1">Result</th>
                <th scope="col" className="text-right py-1">Stake</th>
                <th scope="col" className="text-right py-1">Mult</th>
                <th scope="col" className="text-right py-1">Payout</th>
                <th scope="col" className="text-right py-1">Time</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="border-t border-game-border">
                  {showGame && <td className="py-1.5 pr-2 text-gray-300">{gameLabel(e.game)}</td>}
                  <td className="py-1.5"><OutcomeBadge status={e.status} /></td>
                  <td className="text-right text-white">{(e.stake / 100).toFixed(0)}</td>
                  <td className="text-right text-gray-300">
                    {e.multiplier != null ? `${e.multiplier.toFixed(2)}×` : '-'}
                  </td>
                  <td className={`text-right font-semibold ${e.status === 'won' ? 'text-accent-cyan' : 'text-gray-400'}`}>
                    {e.status === 'won' ? (e.payout / 100).toFixed(0) : '-'}
                  </td>
                  <td className="text-right text-gray-500 whitespace-nowrap">{relativeTime(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
