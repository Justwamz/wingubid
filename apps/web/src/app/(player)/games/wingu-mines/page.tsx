'use client'
import { useState } from 'react'
import { useMinesGame } from '@/hooks/useMinesGame'
import { MinesGrid } from '@/components/game/MinesGrid'
import { MinesHistory } from '@/components/game/MinesHistory'
import { HowToPlay } from '@/components/game/HowToPlay'
import { QuickStakes } from '@/components/game/QuickStakes'
import { DEFAULT_STAKE_KES } from '@/lib/gameConfig'
import { Gem, Search, DollarSign } from 'lucide-react'

const HOW_TO_PLAY = [
  { icon: <Gem size={16} />, text: 'Choose your grid size, number of mines, and stake. More mines = bigger multiplier.' },
  { icon: <Search size={16} />, text: 'Click tiles to reveal gems. Each safe tile increases your multiplier.' },
  { icon: <DollarSign size={16} />, text: 'Cash out any time to keep your winnings. Hit a mine and lose your stake.' },
]

export default function WinguMinesPage() {
  const { game, loading, error, startGame, revealTile, cashout } = useMinesGame()
  const [stake, setStake] = useState(String(DEFAULT_STAKE_KES))
  const [gridSize, setGridSize] = useState(3)
  const [mineCount, setMineCount] = useState(2)

  const isActive = game?.status === 'active'
  const isOver = game?.status === 'won' || game?.status === 'lost'

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
          {!isActive && (
            <div className="bg-game-card border border-game-border rounded-2xl p-5 space-y-4">
              <input
                type="number"
                placeholder="Stake (KES)"
                value={stake}
                onChange={e => setStake(e.target.value)}
                className="w-full bg-game-bg border border-game-border rounded-xl px-4 py-3 text-white font-mono focus:outline-none focus:border-accent-violet text-sm"
              />
              <QuickStakes
                onSelect={v => setStake(String(v))}
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
                onClick={() => startGame(parseInt(stake) * 100, gridSize, mineCount)}
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
          <MinesHistory />
        </div>
      </div>
    </div>
  )
}
