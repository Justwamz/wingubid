'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { isAuthenticated } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import { Menu, X, HelpCircle } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface Banner {
  headline: string
  subtext?: string
  ctaText?: string
  ctaUrl?: string
  imageUrl?: string
  gradient: string
}

const SECONDARY_NAV = [
  { label: 'CASINO',   href: '/register', hot: false },
  { label: 'AVIATOR',  href: '/register', hot: true  },
  { label: 'JETX',     href: '/register', hot: false },
  { label: 'LOTTO',    href: '/register', hot: true  },
  { label: 'SCRATCH',  href: '/register', hot: true  },
  { label: 'DICE',     href: '/register', hot: false },
  { label: 'MINES',    href: '/register', hot: false },
]

const CAROUSEL_SLIDES = [
  {
    id: 'betbuilder',
    bgColor: '#1a0800',
    gradient: 'from-orange-950/90 via-amber-900/70 to-yellow-900/40',
    headline: 'JENGA BET NA\nBET BUILDER',
    subtext: 'Build your perfect bet today',
    ctaText: 'Play Now',
    ctaHref: '/register',
  },
  {
    id: 'crash',
    bgColor: '#001828',
    gradient: 'from-cyan-950/90 via-blue-900/70 to-violet-900/40',
    headline: 'CRASH YOUR WAY\nTO THE TOP',
    subtext: 'Cash out before the crash — every second counts',
    ctaText: 'Play Crash',
    ctaHref: '/register',
  },
  {
    id: 'lotto',
    bgColor: '#1a1000',
    gradient: 'from-yellow-950/90 via-amber-900/70 to-orange-900/40',
    headline: 'HOURLY JACKPOTS\nWAITING FOR YOU',
    subtext: 'Pick 3 numbers. Draw every hour.',
    ctaText: 'Play Lotto',
    ctaHref: '/register',
  },
  {
    id: 'scratch',
    bgColor: '#1a0020',
    gradient: 'from-pink-950/90 via-rose-900/70 to-purple-900/40',
    headline: 'SCRATCH & WIN\nINSTANT PRIZES',
    subtext: 'Match 3 symbols. Win instantly.',
    ctaText: 'Play Scratch',
    ctaHref: '/register',
  },
]

const QUICK_GAMES = [
  {
    type: 'INSTANT',
    typeColor: '#EC4899',
    typeBg: 'rgba(236,72,153,0.15)',
    name: 'SCRATCH',
    description: 'Instant win scratch cards',
    href: '/games/scratch',
    accentColor: '#EC4899',
    cardBg: 'linear-gradient(160deg,#1a0830,#2d1040)',
    border: '1px solid rgba(236,72,153,0.25)',
    icon: (
      <svg viewBox="0 0 28 28" width="28" height="28" fill="none">
        <rect x="1" y="5" width="26" height="18" rx="3" stroke="#EC4899" strokeWidth="1.5"/>
        <rect x="4" y="9"  width="7" height="5" rx="1" fill="rgba(236,72,153,0.25)" stroke="#EC4899" strokeWidth="1"/>
        <rect x="14" y="9" width="7" height="5" rx="1" fill="rgba(236,72,153,0.25)" stroke="#EC4899" strokeWidth="1"/>
        <rect x="9"  y="16" width="10" height="5" rx="1" fill="#EC4899" stroke="#EC4899" strokeWidth="1"/>
      </svg>
    ),
  },
  {
    type: 'INSTANT',
    typeColor: '#00C896',
    typeBg: 'rgba(0,200,150,0.15)',
    name: 'DICE',
    description: 'Roll over or under your target',
    href: '/games/dice',
    accentColor: '#00C896',
    cardBg: 'linear-gradient(160deg,#041a12,#082a1e)',
    border: '1px solid rgba(0,200,150,0.25)',
    icon: (
      <svg viewBox="0 0 28 28" width="28" height="28" fill="none">
        <rect x="1" y="7" width="14" height="14" rx="3" fill="#041a12" stroke="#00C896" strokeWidth="1.5"/>
        <circle cx="5"  cy="11" r="1.3" fill="#00C896"/>
        <circle cx="11" cy="11" r="1.3" fill="#00C896"/>
        <circle cx="8"  cy="14" r="1.3" fill="#00C896"/>
        <circle cx="5"  cy="17" r="1.3" fill="#00C896"/>
        <circle cx="11" cy="17" r="1.3" fill="#00C896"/>
        <rect x="16" y="13" width="11" height="11" rx="3" fill="#041a12" stroke="#00C896" strokeWidth="1.5"/>
        <circle cx="21.5" cy="18.5" r="1.8" fill="#00C896"/>
      </svg>
    ),
  },
  {
    type: 'HOURLY',
    typeColor: '#F59E0B',
    typeBg: 'rgba(245,158,11,0.15)',
    name: 'LOTTO',
    description: 'Pick 3, draw every hour',
    href: '/games/lottery',
    accentColor: '#F59E0B',
    cardBg: 'linear-gradient(160deg,#1a1000,#2a1a00)',
    border: '1px solid rgba(245,158,11,0.25)',
    icon: (
      <svg viewBox="0 0 28 28" width="28" height="28" fill="none">
        <circle cx="6"  cy="14" r="5" stroke="#F59E0B" strokeWidth="1.5" fill="rgba(245,158,11,0.1)"/>
        <text x="6"  y="17.5" fontSize="6" fontWeight="bold" textAnchor="middle" fill="#F59E0B">7</text>
        <circle cx="14" cy="14" r="5" stroke="#F59E0B" strokeWidth="1.5" fill="rgba(245,158,11,0.25)"/>
        <text x="14" y="17.5" fontSize="6" fontWeight="bold" textAnchor="middle" fill="#F59E0B">9</text>
        <circle cx="22" cy="14" r="5" stroke="#F59E0B" strokeWidth="1.5" fill="rgba(245,158,11,0.1)"/>
        <text x="22" y="17.5" fontSize="6" fontWeight="bold" textAnchor="middle" fill="#F59E0B">3</text>
      </svg>
    ),
  },
]

// Crash games — Aviator / Aviatrix / JetX are placeholder UI; Crash is live
const CRASH_GAMES = [
  {
    name: 'Aviator',
    active: false,
    href: '/register',
    artwork: '',
    placeholderBg: 'linear-gradient(135deg,#b34700 0%,#ff9500 50%,#ffd000 100%)',
    placeholderLabel: 'AVIATOR',
    labelColor: '#fff',
  },
  {
    name: 'Aviatrix',
    active: false,
    href: '/register',
    artwork: '',
    placeholderBg: 'linear-gradient(135deg,#1a0840 0%,#3d1a80 50%,#2a0e60 100%)',
    placeholderLabel: 'AVIATRIX',
    labelColor: '#fff',
  },
  {
    name: 'JetX',
    active: false,
    href: '/register',
    artwork: '',
    placeholderBg: 'linear-gradient(135deg,#050d2a 0%,#0d1f5c 50%,#1a3a80 100%)',
    placeholderLabel: 'JETX',
    labelColor: '#fff',
  },
  {
    name: 'Crash',
    active: true,
    href: '/games/crash',
    artwork: '',
    placeholderBg: 'linear-gradient(135deg,#4a0000 0%,#cc2200 50%,#ff6600 100%)',
    placeholderLabel: 'CRASH',
    labelColor: '#fff',
  },
]

// Casino games — B-Ball Blitz / Sun of Egypt 4 are placeholder UI; rest are live
const CASINO_GAMES = [
  {
    name: 'B-Ball Blitz',
    active: false,
    href: '/register',
    artwork: '',
    placeholderBg: 'linear-gradient(135deg,#060f2a 0%,#0d2460 50%,#1a3a80 100%)',
    placeholderLabel: 'B-BALL BLITZ',
    labelColor: '#fff',
  },
  {
    name: 'Sun of Egypt 4',
    active: false,
    href: '/register',
    artwork: '',
    placeholderBg: 'linear-gradient(135deg,#2a1400 0%,#7a3a00 50%,#c47a00 100%)',
    placeholderLabel: 'SUN OF EGYPT 4',
    labelColor: '#fff',
  },
  {
    name: 'Mines',
    active: true,
    href: '/games/mines',
    artwork: '',
    placeholderBg: 'linear-gradient(135deg,#1a0840 0%,#3d1a80 60%,#2d1060 100%)',
    placeholderLabel: 'MINES',
    labelColor: '#d4b8ff',
  },
  {
    name: 'Dice',
    active: true,
    href: '/games/dice',
    artwork: '',
    placeholderBg: 'linear-gradient(135deg,#041a12 0%,#0a3d28 60%,#0d4a30 100%)',
    placeholderLabel: 'DICE',
    labelColor: '#7fffd4',
  },
  {
    name: 'Lotto',
    active: true,
    href: '/games/lottery',
    artwork: '',
    placeholderBg: 'linear-gradient(135deg,#1a1000 0%,#4a3000 60%,#6a4400 100%)',
    placeholderLabel: 'LOTTO',
    labelColor: '#ffd966',
  },
  {
    name: 'Scratch',
    active: true,
    href: '/games/scratch',
    artwork: '',
    placeholderBg: 'linear-gradient(135deg,#1a0830 0%,#4d1060 60%,#3d0a50 100%)',
    placeholderLabel: 'SCRATCH',
    labelColor: '#ff9de2',
  },
]

export default function LandingPage() {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [slideIdx, setSlideIdx] = useState(0)
  const [banner, setBanner] = useState<Banner | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isAuthenticated()) { router.replace('/games'); return }
    fetch(`${API_URL}/banners/landing`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { banner: Banner } | null) => { if (d?.banner) setBanner(d.banner) })
      .catch(() => {})
  }, [router])

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setSlideIdx(i => (i + 1) % CAROUSEL_SLIDES.length), 4500)
  }, [])

  useEffect(() => { startTimer(); return () => { if (timerRef.current) clearInterval(timerRef.current) } }, [startTimer])

  const goTo = (i: number) => { setSlideIdx(i); startTimer() }

  const raw = CAROUSEL_SLIDES[slideIdx]
  const current = slideIdx === 0 && banner
    ? { ...raw, headline: banner.headline, subtext: banner.subtext ?? raw.subtext, ctaText: banner.ctaText ?? raw.ctaText, ctaHref: banner.ctaUrl ?? raw.ctaHref, imageUrl: banner.imageUrl }
    : { ...raw, imageUrl: undefined }

  return (
    <div className="min-h-screen text-white overflow-x-hidden" style={{ background: '#160B2E' }}>

      {/* ── Main Nav ── */}
      <nav className="sticky top-0 z-50" style={{ background: '#160B2E', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="relative flex items-center justify-between px-4 h-16 max-w-7xl mx-auto">
          <button onClick={() => setMenuOpen(o => !o)} className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/5 transition-colors" aria-label="Menu">
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>

          <Link href="/" className="absolute left-1/2 -translate-x-1/2">
            <img src="/wingubet-logo.png" alt="WinguBet" style={{ height: '60px', width: 'auto' }} />
          </Link>

          <div className="flex items-center gap-2">
            <Link href="/login" className="px-3 py-1.5 text-sm font-bold border border-white/30 rounded text-white hover:bg-white/10 transition-colors tracking-wide">
              LOGIN
            </Link>
            <Link href="/register" className="px-3 py-1.5 text-sm font-bold rounded tracking-wide transition-opacity hover:opacity-90" style={{ background: '#00E5FF', color: '#050010' }}>
              REGISTER
            </Link>
          </div>
        </div>

        {/* Mobile slide-down menu */}
        {menuOpen && (
          <div className="border-t border-white/10" style={{ background: '#0F0720' }}>
            <div className="px-4 py-3 grid grid-cols-2 gap-1">
              {SECONDARY_NAV.map(item => (
                <Link key={item.label} href={item.href} onClick={() => setMenuOpen(false)}
                  className="py-2.5 px-3 rounded-lg text-sm font-bold text-white/80 hover:text-white hover:bg-white/5 transition-colors flex items-center gap-1.5">
                  {item.label}{item.hot && <span className="text-orange-400">🔥</span>}
                </Link>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* ── Secondary Nav (horizontal scroll, never collapses) ── */}
      <div className="sticky top-16 z-40 border-b border-white/10" style={{ background: '#0F0720' }}>
        <div className="flex overflow-x-auto scrollbar-hide">
          {SECONDARY_NAV.map((item, i) => (
            <Link key={item.label} href={item.href}
              className="flex-shrink-0 px-4 py-3 text-xs font-extrabold tracking-widest whitespace-nowrap flex items-center gap-1 transition-colors border-b-2"
              style={{
                color: i === 0 ? '#fff' : 'rgba(255,255,255,0.5)',
                borderBottomColor: i === 0 ? '#00E5FF' : 'transparent',
              }}>
              {item.label}{item.hot && <span style={{ color: '#FF7A00', fontSize: '11px' }}>🔥</span>}
            </Link>
          ))}
        </div>
      </div>

      {/* ── Hero Carousel ── */}
      <section className="relative overflow-hidden" style={{ height: '230px' }}>
        <div className="absolute inset-0 transition-colors duration-700" style={{ background: current.bgColor }} />
        <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${current.bgColor} 0%, #2a1040 100%)` }} />
        {current.imageUrl && (
          <img src={current.imageUrl} className="absolute inset-0 w-full h-full object-cover opacity-40" alt="" />
        )}
        <div className="absolute inset-0" style={{ background: `linear-gradient(to right, rgba(0,0,0,0.6) 0%, transparent 70%)` }} />

        <div className="relative z-10 h-full flex flex-col justify-center px-5 max-w-lg">
          <h1 className="text-3xl md:text-4xl font-black leading-tight text-white mb-2" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.7)', letterSpacing: '-0.01em' }}>
            {current.headline.split('\n').map((line, i, arr) => (
              <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
            ))}
          </h1>
          {current.subtext && <p className="text-white/60 text-sm mb-4">{current.subtext}</p>}
          <Link href={current.ctaHref}
            className="inline-block px-5 py-2 text-sm font-bold rounded-lg w-fit transition-opacity hover:opacity-90"
            style={{ background: '#00E5FF', color: '#050010' }}>
            {current.ctaText} →
          </Link>
        </div>

        {/* Carousel dots */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 z-20">
          {CAROUSEL_SLIDES.map((_, i) => (
            <button key={i} onClick={() => goTo(i)} aria-label={`Slide ${i + 1}`}
              className="rounded-full transition-all duration-300"
              style={{ width: i === slideIdx ? '18px' : '6px', height: '6px', background: i === slideIdx ? '#00E5FF' : 'rgba(255,255,255,0.3)' }} />
          ))}
        </div>
      </section>

      {/* ── Quick Game Cards ── */}
      <section className="px-3 pt-4 pb-2 max-w-7xl mx-auto">
        <div className="grid grid-cols-3 gap-2">
          {QUICK_GAMES.map(g => (
            <div key={g.name} className="rounded-xl p-3 flex flex-col gap-2" style={{ background: g.cardBg, border: g.border }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded tracking-wide" style={{ background: g.typeBg, color: g.typeColor }}>{g.type}</span>
                {g.icon}
              </div>
              <div>
                <p className="text-xs font-extrabold tracking-wide" style={{ color: g.accentColor }}>{g.name}</p>
                <p className="text-[10px] text-gray-500 leading-snug mt-0.5">{g.description}</p>
              </div>
              <button className="text-[10px] text-gray-600 flex items-center gap-1 mt-auto">
                <HelpCircle size={9} /> How to play
              </button>
              <Link href={g.href}
                className="block text-center py-1.5 rounded-lg text-[11px] font-bold tracking-wide transition-opacity hover:opacity-80"
                style={{ background: `${g.accentColor}20`, border: `1px solid ${g.accentColor}40`, color: g.accentColor }}>
                PLAY NOW →
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ── Crash Games ── */}
      <section className="px-3 pt-5 pb-2 max-w-7xl mx-auto">
        <SectionHeader title="CRASH GAMES" />
        <div className="grid grid-cols-2 gap-2 mt-3">
          {CRASH_GAMES.map(g => <GameCard key={g.name} game={g} />)}
        </div>
      </section>

      {/* ── Casino ── */}
      <section className="px-3 pt-5 pb-6 max-w-7xl mx-auto">
        <SectionHeader title="CASINO" />
        <div className="grid grid-cols-2 gap-2 mt-3">
          {CASINO_GAMES.map(g => <GameCard key={g.name} game={g} />)}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <img src="/wingubet-logo.png" alt="WinguBet" style={{ height: '44px', width: 'auto' }} />
          <p className="text-xs text-gray-600 text-center">18+ only · Please gamble responsibly · Demonstration platform</p>
          <div className="flex gap-6 text-xs text-gray-600">
            <Link href="/login" className="hover:text-gray-400 transition-colors">Log in</Link>
            <Link href="/register" className="hover:text-gray-400 transition-colors">Register</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <span className="inline-block px-4 py-1.5 text-sm font-extrabold rounded tracking-wider" style={{ background: '#D4900A', color: '#1a0800' }}>
      {title}
    </span>
  )
}

interface GameEntry {
  name: string
  active: boolean
  href: string
  artwork: string
  placeholderBg: string
  placeholderLabel: string
  labelColor: string
}

function GameCard({ game }: { game: GameEntry }) {
  const inner = (
    <div className="relative rounded-xl overflow-hidden group" style={{ aspectRatio: '16/9' }}>
      {game.artwork ? (
        <img src={game.artwork} alt={game.name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-end p-3" style={{ background: game.placeholderBg }}>
          <span className="font-black text-lg md:text-xl leading-tight" style={{ color: game.labelColor, textShadow: '0 2px 8px rgba(0,0,0,0.7)' }}>
            {game.placeholderLabel}
          </span>
        </div>
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors" />
      {!game.active && (
        <div className="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.6)' }}>
          COMING SOON
        </div>
      )}
    </div>
  )
  return game.active ? <Link href={game.href}>{inner}</Link> : <div>{inner}</div>
}
