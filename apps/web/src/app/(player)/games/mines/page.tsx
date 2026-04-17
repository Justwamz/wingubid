'use client'
import { useState } from 'react'
import { useMinesGame } from '@/hooks/useMinesGame'
import { MinesGrid } from '@/components/game/MinesGrid'
import { MinesHistory } from '@/components/game/MinesHistory'

export default function MinesPage() {
  const { game, loading, error, startGame, revealTile, cashout } = useMinesGame()
  const [stake, setStake] = useState('')
  const [gridSize, setGridSize] = useState(3)
  const [mineCount, setMineCount] = useState(2)

  const isActive = game?.status === 'active'
  const isOver = game?.status === 'won' || game?.status === 'lost'

  return (
    <div className="min-h-screen bg-game-bg text-white flex flex-col p-4 gap-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-accent-cyan font-mono">MINES</h1>

      {!isActive && (
        <div className="bg-game-card border border-game-border rounded-xl p-4 space-y-3">
          <input
            type="number"
            placeholder="Stake (KES)"
            value={stake}
            onChange={e => setStake(e.target.value)}
            className="w-full bg-game-bg border border-game-border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-accent-cyan"
          />
          <div className="flex gap-2">
            {[3, 4, 5].map(g => (
              <button
                key={g}
                onClick={() => setGridSize(g)}
                className={`flex-1 py-2 rounded-lg font-mono font-bold border ${gridSize === g ? 'border-accent-cyan text-accent-cyan' : 'border-game-border text-gray-400'}`}
              >
                {g}×{g}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">Mines: {mineCount}</span>
            <input
              type="range" min="1" max={gridSize * gridSize - 1}
              value={mineCount} onChange={e => setMineCount(Number(e.target.value))}
              className="flex-1 accent-accent-cyan"
            />
          </div>
          <button
            onClick={() => startGame(parseInt(stake), gridSize, mineCount)}
            disabled={loading || !stake}
            className="w-full py-3 rounded-xl font-bold text-game-bg bg-accent-cyan text-lg disabled:opacity-40"
          >
            {loading ? 'Starting…' : 'Start Game'}
          </button>
        </div>
      )}

      {game && (
        <>
          {isActive && (
            <div className="flex items-center justify-between px-1">
              <span className="text-sm text-gray-400">Multiplier</span>
              <span className="text-accent-cyan font-mono font-bold text-xl">{game.multiplier.toFixed(2)}×</span>
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
              className="w-full py-3 rounded-xl font-bold text-game-bg bg-accent-cyan text-lg"
            >
              Cash Out — KES {Math.floor(parseInt(stake || '0') * game.multiplier)}
            </button>
          )}

          {isOver && (
            <div className={`text-center py-3 rounded-xl font-bold text-lg ${game.status === 'won' ? 'text-accent-cyan' : 'text-warning-coral'}`}>
              {game.status === 'won' ? '💎 You won!' : '💥 Mine hit!'}
            </div>
          )}

          {isOver && (
            <button
              onClick={() => window.location.reload()}
              className="w-full py-2 rounded-xl border border-accent-violet text-accent-violet"
            >
              Play Again
            </button>
          )}
        </>
      )}

      {error && <p className="text-warning-coral text-sm text-center">{error}</p>}

      <MinesHistory />
    </div>
  )
}
