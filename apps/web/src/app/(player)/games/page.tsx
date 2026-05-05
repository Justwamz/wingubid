'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface LeaderboardEntry {
  playerName: string; game: string; multiplier: number; winnings: number; currency: string
}

interface Banner {
  headline: string
  subtext?: string
  ctaText?: string
  ctaUrl?: string
  imageUrl?: string
  gradient: string
}

const GAMES = [
  {
    href: '/games/crash',
    name: 'CRASH',
    tagline: 'Cash out before it crashes',
    description: 'Watch the multiplier climb and bail out at the right moment. The longer you wait, the bigger the reward — but wait too long and you lose everything.',
    gradient: 'from-cyan-500/20 to-blue-600/10',
    border: 'border-cyan-500/30',
    accent: '#00F2FE',
    badge: 'LIVE',
    badgeColor: 'bg-cyan-500/20 text-cyan-400',
    visual: (
      <svg viewBox="0 0 80 50" className="w-20 h-12 opacity-80">
        <polyline points="0,45 20,40 35,28 50,15 65,8 80,4" fill="none" stroke="#00F2FE" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="80" cy="4" r="3" fill="#00F2FE"/>
      </svg>
    ),
  },
  {
    href: '/games/mines',
    name: 'MINES',
    tagline: 'Reveal gems, avoid mines',
    description: 'Uncover gems on the grid to multiply your stake. Every tile you reveal increases your winnings — but one mine ends it all. Cash out anytime.',
    gradient: 'from-violet-500/20 to-purple-700/10',
    border: 'border-violet-500/30',
    accent: '#80508B',
    badge: 'INSTANT',
    badgeColor: 'bg-violet-500/20 text-violet-300',
    visual: (
      <svg viewBox="0 0 80 50" className="w-20 h-12 opacity-80">
        {[0,1,2,3,4,5].map(i => (
          <rect key={i} x={4 + (i % 3) * 25} y={4 + Math.floor(i / 3) * 22} width="20" height="18" rx="3"
            fill={i === 2 ? '#80508B' : i === 4 ? '#FF4E50' : '#3a3530'} stroke="#80508B" strokeWidth="0.5"/>
        ))}
        <text x="51" y="18" fontSize="10" textAnchor="middle" fill="#00F2FE">💎</text>
        <text x="26" y="40" fontSize="10" textAnchor="middle" fill="#FF4E50">💣</text>
      </svg>
    ),
  },
  {
    href: '/games/dice',
    name: 'DICE',
    tagline: 'Roll over or under your target',
    description: 'Set your target number and predict whether the roll will go higher or lower. Adjust the range to control your risk — tighter range, bigger multiplier.',
    gradient: 'from-emerald-500/20 to-teal-600/10',
    border: 'border-emerald-500/30',
    accent: '#00C896',
    badge: 'INSTANT',
    badgeColor: 'bg-emerald-500/20 text-emerald-300',
    visual: (
      <svg viewBox="0 0 80 50" className="w-20 h-12 opacity-80">
        <rect x="10" y="5" width="30" height="30" rx="6" fill="#272422" stroke="#00C896" strokeWidth="1.5"/>
        <circle cx="18" cy="13" r="3" fill="#00C896"/>
        <circle cx="32" cy="13" r="3" fill="#00C896"/>
        <circle cx="25" cy="20" r="3" fill="#00C896"/>
        <circle cx="18" cy="27" r="3" fill="#00C896"/>
        <circle cx="32" cy="27" r="3" fill="#00C896"/>
        <rect x="45" y="15" width="30" height="30" rx="6" fill="#272422" stroke="#00C896" strokeWidth="1.5"/>
        <circle cx="60" cy="30" r="3.5" fill="#00C896"/>
      </svg>
    ),
  },
  {
    href: '/games/lottery',
    name: 'LOTTO',
    tagline: 'Pick 3, draw every hour',
    description: 'Choose three numbers and wait for the hourly draw. Match all three to win big. Simple to play, huge potential payouts every hour.',
    gradient: 'from-yellow-500/20 to-orange-600/10',
    border: 'border-yellow-500/30',
    accent: '#F59E0B',
    badge: 'HOURLY',
    badgeColor: 'bg-yellow-500/20 text-yellow-300',
    visual: (
      <svg viewBox="0 0 80 50" className="w-20 h-12 opacity-80">
        {[0,1,2].map(i => (
          <circle key={i} cx={14 + i * 26} cy="25" r="12" fill="#272422" stroke="#F59E0B" strokeWidth="1.5"/>
        ))}
        <text x="14" y="29" fontSize="10" textAnchor="middle" fill="#F59E0B" fontWeight="bold">7</text>
        <text x="40" y="29" fontSize="10" textAnchor="middle" fill="#F59E0B" fontWeight="bold">3</text>
        <text x="66" y="29" fontSize="10" textAnchor="middle" fill="#F59E0B" fontWeight="bold">9</text>
      </svg>
    ),
  },
  {
    href: '/games/scratch',
    name: 'SCRATCH',
    tagline: 'Instant win scratch cards',
    description: 'Scratch to reveal your prize instantly. No waiting, no strategy required — pure instant-win excitement with every card.',
    gradient: 'from-pink-500/20 to-rose-600/10',
    border: 'border-pink-500/30',
    accent: '#F43F5E',
    badge: 'INSTANT',
    badgeColor: 'bg-pink-500/20 text-pink-300',
    visual: (
      <svg viewBox="0 0 80 50" className="w-20 h-12 opacity-80">
        <rect x="5" y="8" width="70" height="34" rx="5" fill="#272422" stroke="#F43F5E" strokeWidth="1.5"/>
        <rect x="12" y="14" width="18" height="14" rx="3" fill="#F43F5E22" stroke="#F43F5E" strokeWidth="0.8"/>
        <rect x="34" y="14" width="18" height="14" rx="3" fill="#F43F5E44" stroke="#F43F5E" strokeWidth="0.8"/>
        <rect x="56" y="14" width="18" height="14" rx="3" fill="#F43F5E22" stroke="#F43F5E" strokeWidth="0.8"/>
        <text x="21" y="25" fontSize="9" textAnchor="middle" fill="#F43F5E">★</text>
        <text x="43" y="25" fontSize="9" textAnchor="middle" fill="#F43F5E">★</text>
        <text x="65" y="25" fontSize="9" textAnchor="middle" fill="#F43F5E">★</text>
      </svg>
    ),
  },
]

export default function GamesLobby() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)

  useEffect(() => {
    const load = () => apiFetch<LeaderboardEntry[]>('/games/leaderboard')
      .then(({ data }) => data && setLeaderboard(data))
    load()
    const id = setInterval(load, 5000)

    apiFetch<{ banner: Banner | null }>('/banners/lobby')
      .then(({ data }) => data?.banner ? setBanner(data.banner) : null)

    return () => clearInterval(id)
  }, [])

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Lobby banner */}
      {banner && (
        <div className="relative w-full rounded-xl overflow-hidden mb-6 bg-[#0a1628] min-h-[120px]">
          <div className={`absolute inset-0 bg-gradient-to-r ${banner.gradient}`} />
          {banner.imageUrl && (
            <img src={banner.imageUrl} className="absolute inset-0 w-full h-full object-cover opacity-40" alt="" />
          )}
          <div className="relative z-10 p-6">
            <h2 className="text-2xl font-bold text-white">{banner.headline}</h2>
            {banner.subtext && <p className="text-gray-200 mt-1">{banner.subtext}</p>}
            {banner.ctaText && banner.ctaUrl && (
              <a href={banner.ctaUrl} className="inline-block mt-3 bg-white/20 hover:bg-white/30 text-white font-semibold px-4 py-2 rounded-lg transition-colors">
                {banner.ctaText}
              </a>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Game cards */}
        <div className="flex-1">
          <h2 className="text-2xl font-extrabold font-mono mb-4" style={{ color: '#00F2FE' }}>
            GAMES
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {GAMES.map(g => (
              <div key={g.href} className={`bg-gradient-to-br ${g.gradient} border ${g.border} rounded-2xl overflow-hidden flex flex-col`}>
                {/* Card header */}
                <div className="p-5 flex-1">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${g.badgeColor}`}>{g.badge}</span>
                      </div>
                      <h3 className="text-xl font-extrabold font-mono" style={{ color: g.accent }}>{g.name}</h3>
                      <p className="text-gray-400 text-sm mt-0.5">{g.tagline}</p>
                    </div>
                    <div className="flex-shrink-0 ml-2">{g.visual}</div>
                  </div>

                  {/* Collapsible instructions */}
                  <button
                    onClick={() => setExpanded(expanded === g.href ? null : g.href)}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors mt-2"
                  >
                    <span className="w-4 h-4 rounded-full border border-gray-600 flex items-center justify-center text-gray-500 leading-none">?</span>
                    How to play
                    <span className="text-gray-600">{expanded === g.href ? '▲' : '▼'}</span>
                  </button>
                  {expanded === g.href && (
                    <p className="mt-2 text-xs text-gray-400 leading-relaxed border-t border-white/5 pt-2">{g.description}</p>
                  )}
                </div>

                {/* Play button */}
                <Link href={g.href} className="block">
                  <div
                    className="mx-4 mb-4 py-2.5 rounded-xl text-center font-bold text-sm transition-opacity hover:opacity-90"
                    style={{ background: `${g.accent}22`, border: `1px solid ${g.accent}44`, color: g.accent }}
                  >
                    PLAY NOW →
                  </div>
                </Link>
              </div>
            ))}
          </div>
        </div>

        {/* Leaderboard sidebar */}
        <div className="lg:w-72 xl:w-80 flex-shrink-0">
          <h2 className="text-sm font-mono font-bold text-gray-400 uppercase tracking-widest mb-4">Recent Wins</h2>
          {leaderboard.length === 0 ? (
            <div className="text-gray-600 text-sm text-center py-8 border border-game-border rounded-xl">
              No recent wins yet
            </div>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((e, i) => (
                <div key={i} className="flex items-center gap-3 bg-game-card border border-game-border rounded-xl px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{e.playerName}</p>
                    <p className="text-gray-500 text-xs uppercase">{e.game}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-accent-cyan font-mono font-bold text-sm">{e.multiplier.toFixed(2)}×</p>
                    <p className="text-gray-300 text-xs font-mono">{e.currency} {(e.winnings / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
