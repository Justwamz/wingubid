'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { isAuthenticated } from '@/lib/auth'
import { useRouter } from 'next/navigation'

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
  { label: 'AVIATOR',   href: '/register' },
  { label: 'AVIATRIX',  href: '/register' },
  { label: 'JETX',      href: '/register' },
  { label: 'LOTTO',     href: '/register' },
  { label: 'SCRATCH',   href: '/register' },
  { label: 'DICE',      href: '/register' },
  { label: 'MINES',     href: '/register' },
]

const CAROUSEL_SLIDES = [
  {
    id: 'betbuilder',
    accentColor: '#FF9500',
    bg: 'linear-gradient(135deg, #3d1a00 0%, #7a3500 40%, #1a0800 100%)',
    orb1: 'rgba(255,149,0,0.25)',
    orb2: 'rgba(255,200,0,0.12)',
    badge: 'BET BUILDER',
    headline: 'JENGA BET NA\nBET BUILDER',
    subtext: 'Build your perfect bet today',
    ctaText: 'Play Now',
    ctaHref: '/register',
  },
  {
    id: 'crash',
    accentColor: '#00E5FF',
    bg: 'linear-gradient(135deg, #001828 0%, #003a5c 40%, #001020 100%)',
    orb1: 'rgba(0,229,255,0.2)',
    orb2: 'rgba(80,0,255,0.15)',
    badge: 'CRASH GAME',
    headline: 'CRASH YOUR WAY\nTO THE TOP',
    subtext: 'Cash out before it crashes. Every second counts.',
    ctaText: 'Play Crash',
    ctaHref: '/games/crash',
  },
  {
    id: 'lotto',
    accentColor: '#FFD700',
    bg: 'linear-gradient(135deg, #2a1800 0%, #5a3800 40%, #1a1000 100%)',
    orb1: 'rgba(255,215,0,0.2)',
    orb2: 'rgba(255,100,0,0.12)',
    badge: 'JACKPOT',
    headline: 'HOURLY JACKPOTS\nWAITING FOR YOU',
    subtext: 'Pick 3 numbers. Draws every hour.',
    ctaText: 'Play Lotto',
    ctaHref: '/games/lottery',
  },
  {
    id: 'scratch',
    accentColor: '#FF6EC7',
    bg: 'linear-gradient(135deg, #2a0040 0%, #5a0070 40%, #1a0030 100%)',
    orb1: 'rgba(255,110,199,0.2)',
    orb2: 'rgba(100,0,255,0.15)',
    badge: 'INSTANT WIN',
    headline: 'SCRATCH & WIN\nINSTANT PRIZES',
    subtext: 'Match 3 symbols. Instant payout.',
    ctaText: 'Play Scratch',
    ctaHref: '/games/scratch',
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
    : { ...raw, imageUrl: undefined as string | undefined }

  return (
    <div className="min-h-screen text-white overflow-x-hidden" style={{ background: '#160B2E' }}>

      {/* ── Main Nav ── */}
      <nav className="sticky top-0 z-50 w-full" style={{ background: '#160B2E', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="max-w-7xl mx-auto px-3 h-20 flex items-center justify-between gap-3">
          <Link href="/" className="flex-shrink-0">
            <img src="/wingubet-logo.png" alt="WinguBet" style={{ height: '72px', width: 'auto' }} />
          </Link>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link href="/login" className="px-3 py-1.5 text-xs font-bold border border-white/30 rounded text-white hover:bg-white/10 transition-colors tracking-wide">
              LOGIN
            </Link>
            <Link href="/register" className="px-3 py-1.5 text-xs font-bold rounded tracking-wide transition-opacity hover:opacity-90" style={{ background: '#00E5FF', color: '#050010' }}>
              REGISTER
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Secondary Nav (always horizontal scroll) ── */}
      <div className="sticky top-20 z-40 border-b border-white/10" style={{ background: '#0F0720' }}>
        <div className="max-w-7xl mx-auto flex overflow-x-auto scrollbar-hide">
          {SECONDARY_NAV.map((item, i) => (
            <Link key={item.label} href={item.href}
              className="flex-shrink-0 px-4 py-3 text-xs font-extrabold tracking-widest whitespace-nowrap transition-colors border-b-2"
              style={{
                color: i === 0 ? '#fff' : 'rgba(255,255,255,0.5)',
                borderBottomColor: i === 0 ? '#00E5FF' : 'transparent',
              }}>
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      {/* ── Hero Carousel — same width as game sections ── */}
      <div className="max-w-7xl mx-auto px-3 pt-3">
      <section className="relative overflow-hidden rounded-xl h-64 md:h-72">
        {/* Background */}
        <div className="absolute inset-0 transition-all duration-700" style={{ background: current.bg }} />
        {/* Decorative orbs */}
        <div className="absolute right-0 top-0 w-2/3 h-full pointer-events-none">
          <div className="absolute top-[-20%] right-[-10%] w-[70%] h-[140%] rounded-full blur-3xl" style={{ background: current.orb1 }} />
          <div className="absolute bottom-[-30%] right-[20%] w-[50%] h-[100%] rounded-full blur-2xl" style={{ background: current.orb2 }} />
        </div>
        {/* Image overlay if API banner has one */}
        {current.imageUrl && (
          <img src={current.imageUrl} className="absolute inset-0 w-full h-full object-cover opacity-35" alt="" />
        )}
        {/* Left text shadow overlay */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 60%, transparent 100%)' }} />

        {/* Content */}
        <div className="relative z-10 h-full flex flex-col justify-center px-5 md:px-10 max-w-2xl">
          {/* Badge */}
          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold tracking-widest mb-3 w-fit px-3 py-1 rounded-full"
            style={{ background: 'rgba(255,255,255,0.1)', color: current.accentColor, border: `1px solid ${current.accentColor}40` }}>
            {current.badge}
          </span>
          {/* Headline */}
          <h1 className="font-black leading-[1.05] text-white mb-3"
            style={{ fontSize: 'clamp(1.6rem, 5vw, 3rem)', textShadow: '0 2px 16px rgba(0,0,0,0.6)', letterSpacing: '-0.01em' }}>
            {current.headline.split('\n').map((line, i, arr) => (
              <span key={i} style={{ color: i === 0 ? '#fff' : current.accentColor }}>
                {line}{i < arr.length - 1 && <br />}
              </span>
            ))}
          </h1>
          {current.subtext && (
            <p className="text-white/60 mb-4" style={{ fontSize: 'clamp(0.75rem, 1.8vw, 0.95rem)' }}>{current.subtext}</p>
          )}
          <Link href={current.ctaHref}
            className="inline-block font-bold rounded-lg w-fit transition-all hover:scale-105 hover:opacity-95"
            style={{ background: current.accentColor, color: '#050010', padding: 'clamp(6px,1.2vw,10px) clamp(16px,3vw,24px)', fontSize: 'clamp(0.7rem,1.5vw,0.9rem)' }}>
            {current.ctaText} →
          </Link>
        </div>

        {/* Dot indicators */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-20">
          {CAROUSEL_SLIDES.map((_, i) => (
            <button key={i} onClick={() => goTo(i)} aria-label={`Slide ${i + 1}`}
              className="rounded-full transition-all duration-300"
              style={{ width: i === slideIdx ? '20px' : '6px', height: '6px', background: i === slideIdx ? current.accentColor : 'rgba(255,255,255,0.25)' }} />
          ))}
        </div>
      </section>
      </div>

      {/* ── Quick Game Cards ── */}
      <section className="px-3 pt-4 pb-2 max-w-7xl mx-auto">
        <div className="grid grid-cols-3 gap-2">
          {QUICK_GAMES.map(g => (
            <div key={g.name} className="rounded-xl p-3 flex flex-col gap-2" style={{ background: g.cardBg, border: g.border }}>
              <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded tracking-wide w-fit" style={{ background: g.typeBg, color: g.typeColor }}>{g.type}</span>
              <div>
                <p className="text-xs font-extrabold tracking-wide" style={{ color: g.accentColor }}>{g.name}</p>
                <p className="text-[10px] text-gray-500 leading-snug mt-0.5">{g.description}</p>
              </div>
              <Link href={g.href}
                className="block text-center py-1.5 rounded-lg text-[11px] font-bold tracking-wide transition-opacity hover:opacity-80 mt-auto whitespace-nowrap"
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
          <img src="/wingubet-logo.png" alt="WinguBet" style={{ height: '64px', width: 'auto' }} />
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
          <span className="font-black text-sm md:text-base leading-tight whitespace-nowrap overflow-hidden" style={{ color: game.labelColor, textShadow: '0 2px 8px rgba(0,0,0,0.7)' }}>
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
