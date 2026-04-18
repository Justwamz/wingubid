'use client'
import { useState } from 'react'

interface Step { icon: string; text: string }

interface HowToPlayProps {
  steps: Step[]
}

export function HowToPlay({ steps }: HowToPlayProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-game-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-white transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full border border-gray-600 flex items-center justify-center text-xs text-gray-500">?</span>
          How to play
        </span>
        <span className="text-gray-600 text-xs">{open ? '▲ hide' : '▼ show'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-game-border">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2 pt-3">
              <span className="text-xl leading-none flex-shrink-0">{s.icon}</span>
              <div>
                <span className="text-xs text-gray-500 block mb-0.5">Step {i + 1}</span>
                <p className="text-sm text-gray-300">{s.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
