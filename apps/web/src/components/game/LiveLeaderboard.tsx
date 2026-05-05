import type { CashoutFeed } from '@/hooks/useCrashGame'

export function LiveLeaderboard({ feed }: { feed: CashoutFeed | null }) {
  if (!feed) return null
  return (
    <div className="fixed bottom-20 right-4 bg-game-card border border-accent-cyan rounded-xl px-4 py-2 text-sm animate-bounce-in z-50">
      <span className="text-gray-400">Player cashed out at </span>
      <span className="text-accent-cyan font-mono font-bold">{feed.multiplier.toFixed(2)}×</span>
      <span className="text-gray-400"> · KES </span>
      <span className="text-white font-mono">{(feed.winnings / 100).toFixed(0)}</span>
    </div>
  )
}
