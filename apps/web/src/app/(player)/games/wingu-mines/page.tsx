'use client'
import { useState, useEffect } from 'react'
import { useMinesGame } from '@/hooks/useMinesGame'
import { MinesGrid } from '@/components/game/MinesGrid'
import { GameBetHistory } from '@/components/game/GameBetHistory'
import { HowToPlay } from '@/components/game/HowToPlay'
import { QuickStakes } from '@/components/game/QuickStakes'
import { BonusToggle } from '@/components/game/BonusToggle'
import { DEFAULT_STAKE_KES } from '@/lib/gameConfig'
import { apiFetch } from '@/lib/api'
import { Gem, Search, DollarSign } from 'lucide-react'

const HOW_TO_PLAY = [
  { icon: <Gem size={16} />, text: 'Choose your grid size, number of mines, and stake. More mines = bigger multiplier.' },
  { icon: <Search size={16} />, text: 'Click tiles to reveal gems. Each safe tile increases your multiplier.' },
  { icon: <DollarSign size={16} />, text: 'Cash out any time to keep your winnings. Hit a mine and lose your stake.' },
]

export default function WinguMinesPage() {
  const { game, loading, hydrating, error, startGame, revealTile, cashout } = useMinesGame()
  const [stake, setStake] = useState(String(DEFAULT_STAKE_KES))
  const [gridSize, setGridSize] = useState(3)
  const [mineCount, setMineCount] = useState(2)
  const [fundSource, setFundSource] = useState<'cash' | 'bonus'>('cash')
  const [bonusBalance, setBonusBalance] = useState(0)

  const isActive = game?.status === 'active'
  const isOver = game?.status === 'won' || game?.status === 'lost'

  // Reload bet history each time a game settles.
  const [settledCount, setSettledCount] = useState(0)
  useEffect(() => { if (isOver) setSettledCount(c => c + 1) }, [isOver])

  // Load the player's bonus balance; refetch on the same event the header uses.
  useEffect(() => {
    function loadBonusBalance() {
      apiFetch<{ bonus_balance: number }>('/wallet/balance').then(({ data }) => {
        if (data) setBonusBalance(data.bonus_balance ?? 0)
      })
    }
    loadBonusBalance()
    window.addEventListener('balanceRefresh', loadBonusBalance)
    return () => window.removeEventListener('balanceRefresh', loadBonusBalance)
  }, [])

  // Bonus and cash cannot be mixed in a single bet - cap the stake at the
  // available bonus whenever the player is betting with bonus funds.
  useEffect(() => {
    if (fundSource !== 'bonus') return
    const capKes = bonusBalance / 100
    setStake(prev => {
      const num = parseFloat(prev) || 0
      return num > capKes ? String(capKes) : prev
    })
  }, [fundSource, bonusBalance])

  // If the bonus balance is depleted while betting with bonus, fall back to
  // cash so betting doesn't silently no-op / get rejected by the server.
  useEffect(() => {
    if (bonusBalance <= 0 && fundSource === 'bonus') setFundSource('cash')
  }, [bonusBalance, fundSource])

  function updateStake(v: string) {
    if (fundSource === 'bonus') {
      const capKes = bonusBalance / 100
      const num = parseFloat(v)
      if (!isNaN(num) && num > capKes) v = String(capKes)
    }
    setStake(v)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold font-mono text-accent-violet">WINGU MINES</h1>
        <span className="text-xs px-2 py-1 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20 font-mono">INSTANT</span>
      </div>

      <HowToPlay steps={HOW_TO_PLAY} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Game area */}
        <div className="lg:col-span-2 space-y-4">
          {hydrating && (
            <div className="bg-game-card border border-game-border rounded-2xl p-5 text-center text-gray-500 text-sm">
              Loading…
            </div>
          )}
          {!isActive && !hydrating && (
            <div className="bg-game-card border border-game-border rounded-2xl p-5 space-y-4">
              <BonusToggle bonusBalance={bonusBalance} value={fundSource} onChange={setFundSource} disabled={loading} />
              <input
                type="number"
                placeholder="Stake (KES)"
                value={stake}
                onChange={e => updateStake(e.target.value)}
                className="w-full bg-game-bg border border-game-border rounded-xl px-4 py-3 text-white font-mono focus:outline-none focus:border-accent-violet text-sm"
              />
              <QuickStakes
                onSelect={v => updateStake(String(v))}
                activeValue={parseInt(stake) || undefined}
              />
              <div>
                <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Grid size</p>
                <div className="flex gap-2">
                  {[3, 4, 5].map(g => (
                    <button
                      key={g}
                      onClick={() => setGridSize(g)}
                      className={`flex-1 py-2.5 rounded-xl font-mono font-bold text-sm border transition-all ${
                        gridSize === g
                          ? 'border-accent-violet text-accent-violet bg-violet-500/10'
                          : 'border-game-border text-gray-500 hover:border-gray-500'
                      }`}
                    >
                      {g}×{g}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1 uppercase tracking-wide">
                  <span>Mines</span>
                  <span className="text-accent-violet font-bold">{mineCount}</span>
                </div>
                <input
                  type="range" min="1" max={gridSize * gridSize - 1}
                  value={mineCount} onChange={e => setMineCount(Number(e.target.value))}
                  className="w-full accent-violet-500"
                />
              </div>
              <button
                onClick={() => startGame(Math.floor(parseFloat(stake) * 100), gridSize, mineCount, fundSource)}
                disabled={loading || !stake}
                className="w-full py-3.5 rounded-xl font-bold text-base disabled:opacity-40 transition-all"
                style={{ background: 'linear-gradient(135deg, #80508B, #a06090)', color: '#fff' }}
              >
                {loading ? 'Starting…' : <><Gem size={16} className="inline mr-1.5" />Start Game</>}
              </button>
            </div>
          )}

          {game && (
            <div className="space-y-4">
              {isActive && (
                <div className="bg-game-card border border-violet-500/20 rounded-2xl px-5 py-3 flex items-center justify-between">
                  <span className="text-sm text-gray-400">Current multiplier</span>
                  <span className="text-accent-violet font-mono font-bold text-2xl">{game.multiplier.toFixed(2)}×</span>
                </div>
              )}

              <MinesGrid
                gridSize={game.gridSize}
                revealedTiles={game.revealedTiles}
                minePositions={game.minePositions}
                onReveal={revealTile}
                disabled={!isActive}
              />

              {isActive && game.revealedTiles.length > 0 && (
                <button
                  onClick={cashout}
                  className="w-full py-3.5 rounded-xl font-bold text-base"
                  style={{ background: 'linear-gradient(135deg, #00F2FE, #00C896)', color: '#0a0a0a' }}
                >
                  Cash Out · KES {Math.floor(parseInt(stake || '0') * game.multiplier)}
                </button>
              )}

              {isOver && (
                <>
                  <div className={`text-center py-4 rounded-2xl font-bold text-xl border ${
                    game.status === 'won'
                      ? 'text-accent-cyan border-cyan-500/20 bg-cyan-500/5'
                      : 'text-warning-coral border-red-500/20 bg-red-500/5'
                  }`}>
                    {game.status === 'won' ? <><Gem size={20} className="inline mr-1.5" />You won!</> : 'Mine hit!'}
                  </div>
                  <button
                    onClick={() => window.location.reload()}
                    className="w-full py-3 rounded-xl border border-game-border text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
                  >
                    Play Again
                  </button>
                </>
              )}
            </div>
          )}

          {error && <p className="text-warning-coral text-sm text-center bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}
        </div>

        {/* History sidebar */}
        <div>
          <GameBetHistory game="mines" title="Recent Games" refreshKey={settledCount} />
        </div>
      </div>
    </div>
  )
}
