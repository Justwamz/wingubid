'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { isAuthenticated } from '@/lib/auth'
import { useRouter } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

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
    name: 'CRASH',
    tagline: 'Cash out before it crashes',
    description: 'Watch the multiplier climb and bail at the right moment. The longer you hold, the bigger the payout — but one second too late and you lose it all.',
    accent: '#00F2FE',
    gradient: 'from-cyan-900/40 to-blue-900/20',
    border: 'border-cyan-500/20',
    maxMultiplier: '100×',
    href: '/register',
    visual: (
      <svg viewBox="0 0 120 70" className="w-full h-full opacity-70">
        <defs>
          <linearGradient id="lp-crash-fill" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#00F2FE" stopOpacity="0.05"/>
            <stop offset="100%" stopColor="#00F2FE" stopOpacity="0.25"/>
          </linearGradient>
        </defs>
        <polygon points="0,68 0,54 18,46 35,35 55,20 78,10 100,5 120,2 120,68" fill="url(#lp-crash-fill)"/>
        <polyline points="0,54 18,46 35,35 55,20 78,10 100,5 120,2" fill="none" stroke="#00F2FE" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="120" cy="2" r="4" fill="#00F2FE"/>
        <text x="6" y="50" fontSize="7" fill="#00F2FE" opacity="0.5">1×</text>
        <text x="6" y="32" fontSize="7" fill="#00F2FE" opacity="0.5">3×</text>
        <text x="6" y="14" fontSize="7" fill="#00F2FE" opacity="0.5">10×</text>
      </svg>
    ),
  },
  {
    name: 'MINES',
    tagline: 'Reveal gems, avoid mines',
    description: 'Navigate a hidden minefield. Each gem you uncover multiplies your stake. Walk away rich — or blow it all on a single wrong click.',
    accent: '#80508B',
    gradient: 'from-violet-900/40 to-purple-900/20',
    border: 'border-violet-500/20',
    maxMultiplier: '24×',
    href: '/register',
    visual: (
      <svg viewBox="0 0 120 70" className="w-full h-full opacity-70">
        {[0,1,2,3,4,5,6,7,8].map(i => {
          const col = i % 3, row = Math.floor(i / 3)
          const x = 10 + col * 36, y = 4 + row * 22
          const isGem = i === 1 || i === 5 || i === 7
          const isMine = i === 4
          return (
            <g key={i}>
              <rect x={x} y={y} width="28" height="18" rx="3" fill={isGem ? '#80508B33' : isMine ? '#FF4E5033' : '#1a1025'} stroke={isGem ? '#80508B' : isMine ? '#FF4E50' : '#3a3530'} strokeWidth="1"/>
              {isGem && <text x={x+14} y={y+13} fontSize="9" textAnchor="middle" fill="#b080bb">💎</text>}
              {isMine && <text x={x+14} y={y+13} fontSize="9" textAnchor="middle" fill="#ff7070">💣</text>}
            </g>
          )
        })}
      </svg>
    ),
  },
  {
    name: 'DICE',
    tagline: 'Roll over or under your target',
    description: 'Set your target, choose over or under, and roll. Narrow the range for bigger multipliers. Simple, fast, and entirely in your control.',
    accent: '#00C896',
    gradient: 'from-emerald-900/40 to-teal-900/20',
    border: 'border-emerald-500/20',
    maxMultiplier: '99×',
    href: '/register',
    visual: (
      <svg viewBox="0 0 120 70" className="w-full h-full opacity-70">
        <rect x="10" y="8" width="42" height="42" rx="8" fill="#1a1025" stroke="#00C896" strokeWidth="1.5"/>
        <circle cx="22" cy="20" r="3.5" fill="#00C896"/>
        <circle cx="40" cy="20" r="3.5" fill="#00C896"/>
        <circle cx="31" cy="29" r="3.5" fill="#00C896"/>
        <circle cx="22" cy="38" r="3.5" fill="#00C896"/>
        <circle cx="40" cy="38" r="3.5" fill="#00C896"/>
        <rect x="68" y="20" width="42" height="42" rx="8" fill="#1a1025" stroke="#00C896" strokeWidth="1.5"/>
        <circle cx="89" cy="41" r="4.5" fill="#00C896"/>
        <text x="31" y="65" fontSize="7" fill="#00C896" opacity="0.5" textAnchor="middle">UNDER 50</text>
        <text x="89" y="18" fontSize="7" fill="#00C896" opacity="0.5" textAnchor="middle">OVER 50</text>
      </svg>
    ),
  },
]

const FEATURES = [
  { icon: '⚡', title: 'Instant Payouts', body: 'Winnings hit your balance the moment you cash out. No delays, no holds.' },
  { icon: '🔒', title: 'Provably Fair', body: 'Every outcome is cryptographically verifiable. You can audit any result.' },
  { icon: '📱', title: 'Mobile First', body: 'Designed for your phone. No app download needed — just open and play.' },
  { icon: '🇰🇪', title: 'KES Native', body: 'Play in Kenyan Shillings. No currency conversion, no hidden fees.' },
]

export default function LandingPage() {
  const router = useRouter()
  const [wins, setWins] = useState<LeaderboardEntry[]>([])
  const [banner, setBanner] = useState<Banner | null>(null)

  useEffect(() => {
    if (isAuthenticated()) { router.replace('/games'); return }
    fetch(`${API_URL}/games/leaderboard`)
      .then(r => r.ok ? r.json() : []).then(setWins).catch(() => {})
    fetch(`${API_URL}/banners/landing`)
      .then(r => r.ok ? r.json() : null).then((d: { banner: Banner } | null) => d?.banner ? setBanner(d.banner) : null).catch(() => {})
  }, [router])

  return (
    <div className="min-h-screen bg-[#0d0d14] text-white overflow-x-hidden">

      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b border-white/5 bg-[#0d0d14]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <span className="font-mono font-extrabold text-xl tracking-tight">
            <span className="text-[#00F2FE]">WINGU</span>
            <span className="text-[#80508B]">BET</span>
          </span>
          <div className="flex items-center gap-3">
            <Link href="/login" className="px-4 py-2 text-sm font-semibold text-gray-300 hover:text-white transition-colors">
              Log in
            </Link>
            <Link href="/register"
              className="px-4 py-2 text-sm font-bold rounded-lg text-[#0d0d14] transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #00F2FE, #00C896)' }}>
              Play Now
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none select-none">
          <div className="absolute top-10 left-1/4 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-3xl"/>
          <div className="absolute bottom-0 right-1/3 w-[400px] h-[400px] bg-violet-500/5 rounded-full blur-3xl"/>
        </div>

        <div className="relative max-w-7xl mx-auto px-4 pt-24 pb-16 text-center">
          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-xs text-gray-400 mb-8">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block"/>
            Live now — players winning in real time
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-tight mb-6">
            <span className="text-white">The future of</span>
            <br/>
            <span style={{ background: 'linear-gradient(120deg, #00F2FE 0%, #80508B 60%, #00C896 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              online betting
            </span>
          </h1>

          <p className="text-gray-400 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Three high-octane games. Instant KES payouts. Outcomes you can verify.
            No download required — just register and play.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Link href="/register"
              className="w-full sm:w-auto px-8 py-4 text-base font-bold rounded-xl text-[#0d0d14] transition-transform hover:scale-105"
              style={{ background: 'linear-gradient(135deg, #00F2FE, #00C896)' }}>
              Create Free Account →
            </Link>
            <Link href="/login"
              className="w-full sm:w-auto px-8 py-4 text-base font-semibold rounded-xl border border-white/15 text-gray-300 hover:border-white/30 hover:text-white transition-colors text-center">
              Log in to play
            </Link>
          </div>
        </div>

        {/* Live wins ticker */}
        {wins.length > 0 && (
          <div className="border-t border-b border-white/5 bg-white/[0.02] py-3 overflow-hidden">
            <div className="flex gap-10 animate-marquee whitespace-nowrap">
              {[...wins, ...wins, ...wins].map((w, i) => (
                <span key={i} className="inline-flex items-center gap-2 text-sm flex-shrink-0">
                  <span className="text-gray-500">🏆</span>
                  <span className="text-gray-300 font-semibold">{w.playerName}</span>
                  <span className="text-gray-600 text-xs uppercase font-mono">{w.game}</span>
                  <span className="text-[#00F2FE] font-mono font-bold">{w.multiplier.toFixed(2)}×</span>
                  <span className="text-white font-semibold">{w.currency} {w.winnings}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Promotion banner */}
      {banner && (
        <section className="max-w-7xl mx-auto px-4 pb-8">
          <div className={`relative w-full rounded-xl overflow-hidden bg-gradient-to-r ${banner.gradient} min-h-[120px]`}>
            {banner.imageUrl && (
              <img src={banner.imageUrl} className="absolute inset-0 w-full h-full object-cover opacity-60" alt="" />
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
        </section>
      )}

      {/* Games */}
      <section className="max-w-7xl mx-auto px-4 py-24">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-extrabold mb-3">Three games. Endless action.</h2>
          <p className="text-gray-500 text-lg">Pick your game and start winning in seconds.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {GAMES.map(g => (
            <div key={g.name} className={`bg-gradient-to-br ${g.gradient} border ${g.border} rounded-2xl p-6 flex flex-col gap-5 hover:border-opacity-50 transition-all`}>
              <div className="h-32 w-full">{g.visual}</div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-2xl font-extrabold font-mono" style={{ color: g.accent }}>{g.name}</h3>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full text-gray-400" style={{ background: `${g.accent}15`, border: `1px solid ${g.accent}25` }}>
                    up to {g.maxMultiplier}
                  </span>
                </div>
                <p className="text-sm font-semibold text-gray-300 mb-2">{g.tagline}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{g.description}</p>
              </div>
              <Link href={g.href}
                className="block text-center py-3 rounded-xl text-sm font-bold transition-opacity hover:opacity-80"
                style={{ background: `${g.accent}15`, border: `1px solid ${g.accent}30`, color: g.accent }}>
                Play {g.name} →
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-white/5 bg-white/[0.01]">
        <div className="max-w-7xl mx-auto px-4 py-24">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-extrabold mb-3">Built different.</h2>
            <p className="text-gray-500 text-lg">Everything a serious player needs.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map(f => (
              <div key={f.title} className="rounded-2xl p-6 border border-white/8 bg-white/[0.03] hover:bg-white/[0.05] transition-colors">
                <span className="text-3xl mb-4 block">{f.icon}</span>
                <h3 className="font-bold text-white text-lg mb-2">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-24 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold mb-16">Up and running in 60 seconds.</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {[
              { n: '01', title: 'Create your account', body: 'Sign up with your phone number. Quick, simple, free.' },
              { n: '02', title: 'Pick a game', body: 'Choose Crash, Mines, or Dice. Each round takes under a minute.' },
              { n: '03', title: 'Win and cash out', body: 'Winnings hit your balance instantly. Play again or withdraw.' },
            ].map(s => (
              <div key={s.n} className="flex flex-col items-center gap-3">
                <span className="text-5xl font-extrabold font-mono block mb-2" style={{ color: '#00F2FE', opacity: 0.25 }}>{s.n}</span>
                <h3 className="font-bold text-xl text-white">{s.title}</h3>
                <p className="text-gray-500 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-white/5 bg-gradient-to-br from-cyan-900/10 to-violet-900/10">
        <div className="max-w-3xl mx-auto px-4 py-24 text-center">
          <h2 className="text-4xl md:text-5xl font-extrabold mb-4">Ready to play?</h2>
          <p className="text-gray-400 text-lg mb-10">Create your free account and start with a demo balance.</p>
          <Link href="/register"
            className="inline-block px-10 py-4 text-base font-bold rounded-xl text-[#0d0d14] transition-transform hover:scale-105"
            style={{ background: 'linear-gradient(135deg, #00F2FE, #00C896)' }}>
            Create Free Account →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="font-mono font-extrabold text-lg">
            <span className="text-[#00F2FE]">WINGU</span>
            <span className="text-[#80508B]">BET</span>
          </span>
          <p className="text-xs text-gray-600 text-center">
            18+ only · Please gamble responsibly · This is a demonstration platform
          </p>
          <div className="flex gap-6 text-xs text-gray-600">
            <Link href="/login" className="hover:text-gray-300 transition-colors">Log in</Link>
            <Link href="/register" className="hover:text-gray-300 transition-colors">Register</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
