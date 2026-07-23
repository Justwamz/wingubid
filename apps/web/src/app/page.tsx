'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { isAuthenticated, saveToken } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { X } from 'lucide-react'
import { TermsContent } from '@/components/TermsContent'
import { normalizeKePhone, validateSafaricomPhone } from '@/lib/phone'
import { applyGameOrder } from '@/lib/gameOrder'
import { getDeviceId } from '@/lib/device'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface LiveWin { name: string; game: string; winnings: number; currency: string }

const GAME_LABELS: Record<string, string> = {
  crash: 'Crash', mines: 'Mines', dice: 'Dice', scratch: 'Scratch', lottery: 'Lotto',
}
const gameLabel = (g: string) => GAME_LABELS[g] ?? g

interface Banner {
  headline: string
  subtext?: string
  ctaText?: string
  ctaUrl?: string
  imageUrl?: string
  gradient: string
}

const SECONDARY_NAV = [
  { label: 'AVIATOR',       href: '/register' },
  { label: 'JETX',          href: '/register' },
  { label: 'AVIATRIX',      href: '/register' },
  { label: 'CRASH',         href: '/register' },
  { label: 'WINGU CRASH',   href: '/games/wingu-crash' },
  { label: 'WINGU LOTTO',   href: '/games/wingu-lotto' },
  { label: 'WINGU SCRATCH', href: '/games/wingu-scratch' },
  { label: 'WINGU DICE',    href: '/games/wingu-dice' },
  { label: 'WINGU MINES',   href: '/games/wingu-mines' },
  { label: 'B-BALL BLITZ',  href: '/register' },
  { label: 'SUN OF EGYPT 4',href: '/register' },
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
    id: 'wingu-crash',
    accentColor: '#00E5FF',
    bg: 'linear-gradient(135deg, #001828 0%, #003a5c 40%, #001020 100%)',
    orb1: 'rgba(0,229,255,0.2)',
    orb2: 'rgba(80,0,255,0.15)',
    badge: 'WINGU CRASH',
    headline: 'FLY HIGH,\nCASH OUT IN TIME',
    subtext: 'Cash out before it crashes. Every second counts.',
    ctaText: 'Play Wingu Crash',
    ctaHref: '/games/wingu-crash',
  },
  {
    id: 'wingu-lotto',
    accentColor: '#FFD700',
    bg: 'linear-gradient(135deg, #2a1800 0%, #5a3800 40%, #1a1000 100%)',
    orb1: 'rgba(255,215,0,0.2)',
    orb2: 'rgba(255,100,0,0.12)',
    badge: 'JACKPOT',
    headline: 'HOURLY JACKPOTS\nWAITING FOR YOU',
    subtext: 'Pick 6 numbers. Draws every hour.',
    ctaText: 'Play Wingu Lotto',
    ctaHref: '/games/wingu-lotto',
  },
  {
    id: 'wingu-scratch',
    accentColor: '#FF6EC7',
    bg: 'linear-gradient(135deg, #2a0040 0%, #5a0070 40%, #1a0030 100%)',
    orb1: 'rgba(255,110,199,0.2)',
    orb2: 'rgba(100,0,255,0.15)',
    badge: 'INSTANT WIN',
    headline: 'SCRATCH & WIN\nINSTANT PRIZES',
    subtext: 'Match 3 symbols. Instant payout.',
    ctaText: 'Play Wingu Scratch',
    ctaHref: '/games/wingu-scratch',
  },
]

const QUICK_GAMES = [
  {
    type: 'INSTANT',
    typeColor: '#EC4899',
    typeBg: 'rgba(236,72,153,0.15)',
    name: 'WINGU SCRATCH',
    description: 'Instant win scratch cards',
    href: '/games/wingu-scratch',
    accentColor: '#EC4899',
    cardBg: 'linear-gradient(160deg,#1a0830,#2d1040)',
    border: '1px solid rgba(236,72,153,0.25)',
  },
  {
    type: 'INSTANT',
    typeColor: '#00C896',
    typeBg: 'rgba(0,200,150,0.15)',
    name: 'WINGU DICE',
    description: 'Roll over or under your target',
    href: '/games/wingu-dice',
    accentColor: '#00C896',
    cardBg: 'linear-gradient(160deg,#041a12,#082a1e)',
    border: '1px solid rgba(0,200,150,0.25)',
  },
  {
    type: 'HOURLY',
    typeColor: '#F59E0B',
    typeBg: 'rgba(245,158,11,0.15)',
    name: 'WINGU LOTTO',
    description: 'Pick 6, draw every hour',
    href: '/games/wingu-lotto',
    accentColor: '#F59E0B',
    cardBg: 'linear-gradient(160deg,#1a1000,#2a1a00)',
    border: '1px solid rgba(245,158,11,0.25)',
  },
]

// Crash games - Aviator / Aviatrix / JetX / Crash activate when a provider is configured
const CRASH_GAMES = [
  {
    name: 'Crash',
    slug: 'crash',
    active: false,
    href: '/register',
    artwork: '/games/crash.webp',
    placeholderBg: 'linear-gradient(135deg,#4a0000 0%,#cc2200 50%,#ff6600 100%)',
    placeholderLabel: 'CRASH',
    labelColor: '#fff',
  },
  {
    name: 'Aviator',
    slug: 'aviator',
    active: false,
    href: '/register',
    artwork: '/games/aviator.webp',
    placeholderBg: 'linear-gradient(135deg,#b34700 0%,#ff9500 50%,#ffd000 100%)',
    placeholderLabel: 'AVIATOR',
    labelColor: '#fff',
  },
  {
    name: 'JetX',
    slug: 'jetx',
    active: false,
    href: '/register',
    artwork: '/games/jetx.webp',
    placeholderBg: 'linear-gradient(135deg,#050d2a 0%,#0d1f5c 50%,#1a3a80 100%)',
    placeholderLabel: 'JETX',
    labelColor: '#fff',
  },
  {
    name: 'Aviatrix',
    slug: 'aviatrix',
    active: false,
    href: '/register',
    artwork: '/games/aviatrix.webp',
    placeholderBg: 'linear-gradient(135deg,#1a0840 0%,#3d1a80 50%,#2a0e60 100%)',
    placeholderLabel: 'AVIATRIX',
    labelColor: '#fff',
  },
  {
    name: 'Wingu Crash',
    active: true,
    href: '/games/wingu-crash',
    artwork: '/games/wingu-crash.webp',
    placeholderBg: 'linear-gradient(135deg,#001828 0%,#003a5c 50%,#006080 100%)',
    placeholderLabel: 'WINGU CRASH',
    labelColor: '#00E5FF',
  },
]

// Casino games - B-Ball Blitz / Sun of Egypt 4 activate when a provider is configured
const CASINO_GAMES = [
  {
    name: 'B-Ball Blitz',
    slug: 'bball-blitz',
    active: false,
    href: '/register',
    artwork: '/games/bball-blitz.webp',
    placeholderBg: 'linear-gradient(135deg,#060f2a 0%,#0d2460 50%,#1a3a80 100%)',
    placeholderLabel: 'B-BALL BLITZ',
    labelColor: '#fff',
  },
  {
    name: 'Sun of Egypt 4',
    slug: 'sun-of-egypt-4',
    active: false,
    href: '/register',
    artwork: '/games/sun-of-egypt-4.webp',
    placeholderBg: 'linear-gradient(135deg,#2a1400 0%,#7a3a00 50%,#c47a00 100%)',
    placeholderLabel: 'SUN OF EGYPT 4',
    labelColor: '#fff',
  },
  {
    name: 'Wingu Mines',
    active: true,
    href: '/games/wingu-mines',
    artwork: '/games/wingu-mines.webp',
    placeholderBg: 'linear-gradient(135deg,#1a0840 0%,#3d1a80 60%,#2d1060 100%)',
    placeholderLabel: 'WINGU MINES',
    labelColor: '#d4b8ff',
  },
  {
    name: 'Wingu Dice',
    active: true,
    href: '/games/wingu-dice',
    artwork: '/games/wingu-dice.webp',
    placeholderBg: 'linear-gradient(135deg,#041a12 0%,#0a3d28 60%,#0d4a30 100%)',
    placeholderLabel: 'WINGU DICE',
    labelColor: '#7fffd4',
  },
  {
    name: 'Wingu Lotto',
    active: true,
    href: '/games/wingu-lotto',
    artwork: '/games/wingu-lotto.webp',
    placeholderBg: 'linear-gradient(135deg,#1a1000 0%,#4a3000 60%,#6a4400 100%)',
    placeholderLabel: 'WINGU LOTTO',
    labelColor: '#ffd966',
  },
  {
    name: 'Wingu Scratch',
    active: true,
    href: '/games/wingu-scratch',
    artwork: '/games/wingu-scratch.webp',
    placeholderBg: 'linear-gradient(135deg,#1a0830 0%,#4d1060 60%,#3d0a50 100%)',
    placeholderLabel: 'WINGU SCRATCH',
    labelColor: '#ff9de2',
  },
]

export default function LandingPage() {
  const router = useRouter()
  const [slideIdx, setSlideIdx] = useState(0)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [availableSlugs, setAvailableSlugs] = useState<Set<string>>(new Set())
  const [order, setOrder] = useState<string[]>([])
  const [players, setPlayers] = useState(0)
  const [recentWins, setRecentWins] = useState<LiveWin[]>([])
  const [loginOpen, setLoginOpen] = useState(false)
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isAuthenticated()) { router.replace('/games'); return }
    if (typeof window !== 'undefined') {
      const search = window.location.search
      if (search.includes('register=true')) {
        setAuthTab('register'); setLoginOpen(true); window.history.replaceState(null, '', '/')
      } else if (search.includes('login=true')) {
        setAuthTab('login'); setLoginOpen(true); window.history.replaceState(null, '', '/')
      }
    }
    fetch(`${API_URL}/banners/landing`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { banner: Banner } | null) => { if (d?.banner) setBanner(d.banner) })
      .catch(() => {})
    fetch(`${API_URL}/games/available`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { slugs: string[] } | null) => { if (d?.slugs) setAvailableSlugs(new Set(d.slugs)) })
      .catch(() => {})
    fetch(`${API_URL}/games/config`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { order: string[] } | null) => { if (d?.order) setOrder(d.order) })
      .catch(() => {})
    const loadLive = () => {
      fetch(`${API_URL}/games/presence`)
        .then(r => r.ok ? r.json() : null)
        .then((d: { players: number } | null) => { if (d) setPlayers(d.players) })
        .catch(() => {})
      fetch(`${API_URL}/games/leaderboard`)
        .then(r => r.ok ? r.json() : null)
        .then((d: { wins?: LiveWin[] } | null) => { if (d?.wins) setRecentWins(d.wins) })
        .catch(() => {})
    }
    loadLive()
    const liveTimer = setInterval(loadLive, 12000)
    return () => clearInterval(liveTimer)
  }, [router])

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setSlideIdx(i => (i + 1) % CAROUSEL_SLIDES.length), 4500)
  }, [])

  useEffect(() => { startTimer(); return () => { if (timerRef.current) clearInterval(timerRef.current) } }, [startTimer])

  const goTo = (i: number) => { setSlideIdx(i); startTimer() }

  // Activate provider games that have a configured provider, then reorder each
  // category by the house-optimized rank (live Wingu games move up; "coming
  // soon" provider tiles keep their relative order after them).
  const crashGames = applyGameOrder(
    CRASH_GAMES.map(g => (g.slug && availableSlugs.has(g.slug) ? { ...g, active: true } : g)),
    order,
  )
  const casinoGames = applyGameOrder(
    CASINO_GAMES.map(g => (g.slug && availableSlugs.has(g.slug) ? { ...g, active: true } : g)),
    order,
  )

  const raw = CAROUSEL_SLIDES[slideIdx]
  const current = slideIdx === 0 && banner
    ? { ...raw, headline: banner.headline, subtext: banner.subtext ?? raw.subtext, ctaText: banner.ctaText ?? raw.ctaText, ctaHref: banner.ctaUrl ?? raw.ctaHref, imageUrl: banner.imageUrl }
    : { ...raw, imageUrl: undefined as string | undefined }

  return (
    <div className="min-h-screen text-white overflow-x-hidden" style={{ background: '#160B2E' }}>

      {/* -- Main Nav -- */}
      <nav className="sticky top-0 z-50 w-full" style={{ background: '#160B2E', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="max-w-7xl mx-auto px-3 h-20 md:h-28 flex items-center justify-between gap-3">
          <Link href="/" className="flex-shrink-0">
            <img src="/wingubet-logo.png" alt="WinguBet" className="h-16 md:h-24 w-auto" />
          </Link>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => { setAuthTab('login'); setLoginOpen(true) }} className="px-3 py-1.5 text-xs font-bold border border-white/30 rounded text-white hover:bg-white/10 transition-colors tracking-wide">
              LOGIN
            </button>
            <button onClick={() => { setAuthTab('register'); setLoginOpen(true) }} className="px-3 py-1.5 text-xs font-bold rounded tracking-wide transition-opacity hover:opacity-90" style={{ background: '#00E5FF', color: '#050010' }}>
              REGISTER
            </button>
          </div>
        </div>
      </nav>

      {/* -- Secondary Nav (always horizontal scroll) -- */}
      <div className="sticky top-20 md:top-28 z-40 border-b border-white/10" style={{ background: '#0F0720' }}>
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

      {/* -- Live wins ticker (real data; hidden when sparse) -- */}
      {(players >= 3 || recentWins.length >= 3) && (
        <div className="max-w-7xl mx-auto px-3 pt-3">
          <div className="flex items-center gap-3 bg-game-card border border-game-border rounded-xl overflow-hidden">
            {players >= 3 && (
              <span className="flex-shrink-0 inline-flex items-center gap-1.5 pl-3 py-2 text-xs font-semibold text-green-400 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                {players} playing now
              </span>
            )}
            {recentWins.length >= 3 && (
              <div className="relative flex-1 overflow-hidden py-2">
                <div className="flex w-max animate-marquee">
                  {[0, 1].map(dup => (
                    <div key={dup} className="flex flex-shrink-0" aria-hidden={dup === 1}>
                      {recentWins.map((w, i) => (
                        <span key={`${dup}-${i}`} className="inline-flex items-center gap-1.5 px-4 text-xs whitespace-nowrap">
                          <span className="text-yellow-400">&#127942;</span>
                          <span className="text-white font-semibold">{w.name}</span>
                          <span className="text-gray-500">won</span>
                          <span className="text-accent-cyan font-mono font-semibold">{w.currency} {(w.winnings / 100).toLocaleString('en-KE')}</span>
                          <span className="text-gray-500">on {gameLabel(w.game)}</span>
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* -- Hero Carousel - same width as game sections -- */}
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

      {/* -- Quick Game Cards -- */}
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

      {/* -- Crash Games -- */}
      <section className="px-3 pt-5 pb-2 max-w-7xl mx-auto">
        <SectionHeader title="CRASH GAMES" />
        <div className="grid grid-cols-2 gap-2 mt-3">
          {crashGames.map(g => <GameCard key={g.name} game={g} />)}
        </div>
      </section>

      {/* -- Casino -- */}
      <section className="px-3 pt-5 pb-6 max-w-7xl mx-auto">
        <SectionHeader title="CASINO" />
        <div className="grid grid-cols-2 gap-2 mt-3">
          {casinoGames.map(g => <GameCard key={g.name} game={g} />)}
        </div>
      </section>

      {/* -- Footer -- */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <img src="/wingubet-logo.png" alt="WinguBet" className="h-14 md:h-24 w-auto" />
          <p className="text-xs text-gray-600 text-center">18+ only · Please gamble responsibly · Demonstration platform</p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-gray-600">
            <button onClick={() => { setAuthTab('login'); setLoginOpen(true) }} className="hover:text-gray-400 transition-colors">Log in</button>
            <button onClick={() => { setAuthTab('register'); setLoginOpen(true) }} className="hover:text-gray-400 transition-colors">Register</button>
            <Link href="/terms" className="hover:text-gray-400 transition-colors">Terms &amp; Conditions</Link>
            <a href="mailto:support@wingubet.com" className="hover:text-gray-400 transition-colors">support@wingubet.com</a>
          </div>
        </div>
      </footer>

      {/* -- Login Modal -- */}
      {loginOpen && <LoginModal initialTab={authTab} onClose={() => setLoginOpen(false)} onSuccess={() => router.push('/games')} />}
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
  slug?: string
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

function LoginModal({ onClose, onSuccess, initialTab = 'login' }: { onClose: () => void; onSuccess: () => void; initialTab?: 'login' | 'register' }) {
  const [tab, setTab] = useState<'login' | 'register'>(initialTab)
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [over18, setOver18] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [regStep, setRegStep] = useState<'form' | 'otp'>('form')
  const [otp, setOtp] = useState('')
  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const [showTerms, setShowTerms] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function switchTab(t: 'login' | 'register') {
    setTab(t)
    setError('')
    setRegStep('form')
    setOtp('')
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { data, error: err } = await apiFetch<{ access_token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: normalizeKePhone(phone) ?? phone, password }),
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    saveToken(data!.access_token)
    onSuccess()
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!over18 || !acceptedTerms) {
      setError('Please confirm you are 18+ and accept the Terms & Conditions')
      return
    }
    const check = validateSafaricomPhone(phone)
    if (!check.ok) { setError(check.error); return }
    setPhone(check.e164)
    setError('')
    setLoading(true)
    const { data, error: err } = await apiFetch<{ access_token?: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ phone: check.e164, name, country: 'KE', date_of_birth: dob, password, deviceId: getDeviceId() }),
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    // Move to the OTP verification step. The account is created; we simulate the
    // phone-verification code before completing sign-in.
    setPendingToken(data?.access_token ?? null)
    setOtp('')
    setRegStep('otp')
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit code')
      return
    }
    // SMS disabled (demo): registration already returned a token - accept any
    // 6-digit code and sign in.
    if (pendingToken) {
      saveToken(pendingToken)
      onSuccess()
      return
    }
    // SMS live: verify the code against the server.
    setLoading(true)
    const { data, error: err } = await apiFetch<{ access_token: string }>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, code: otp }),
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    saveToken(data!.access_token)
    onSuccess()
  }

  // Shared visual tokens (match the provided design)
  const CARD_BG = '#241549'
  const INPUT_STYLE = { background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.12)' }
  const inputCls = 'w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-cyan-500'
  const labelCls = 'block text-xs text-gray-300 mb-1.5 uppercase tracking-widest font-semibold'
  const labelCasual = 'block text-sm text-gray-200 mb-1.5 font-semibold'

  const TabButton = ({ id, label }: { id: 'login' | 'register'; label: string }) => {
    const active = tab === id
    return (
      <button
        type="button"
        onClick={() => switchTab(id)}
        className="flex-1 py-3.5 rounded-t-2xl text-sm font-extrabold tracking-widest transition-colors"
        style={{
          background: active ? CARD_BG : '#0E0722',
          color: active ? '#EDE9FB' : 'rgba(255,255,255,0.45)',
          border: active ? '1px solid rgba(255,255,255,0.22)' : '1px solid transparent',
          borderBottom: 'none',
        }}
      >
        {label}
      </button>
    )
  }

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-sm">
        {/* Tabs */}
        <div className="flex gap-2 px-1">
          <TabButton id="login" label="LOGIN" />
          <TabButton id="register" label="REGISTER" />
        </div>

        {/* Card - the top corner under the active tab stays square so the tab
            reads as connected to the card. */}
        <div
          className={`relative rounded-2xl p-6 shadow-2xl ${tab === 'login' ? 'rounded-tl-none' : 'rounded-tr-none'}`}
          style={{ background: CARD_BG, border: '1px solid rgba(255,255,255,0.18)' }}
        >
          <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>

          {/* Logo */}
          <div className="flex justify-center my-4">
            <img src="/wingubet-logo.png" alt="WinguBet" className="h-14 w-auto" />
          </div>

          {tab === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className={labelCls}>Phone</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+254700000000" required className={inputCls} style={INPUT_STYLE} />
              </div>
              <div>
                <label className={labelCls}>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className={inputCls} style={INPUT_STYLE} />
              </div>
              {error && <p className="text-red-400 text-xs bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">{error}</p>}
              <button type="submit" disabled={loading} className="w-full py-3.5 rounded-xl font-extrabold text-sm tracking-widest transition-opacity hover:opacity-90 disabled:opacity-50" style={{ background: '#22D3EE', color: '#0A0420' }}>
                {loading ? 'LOGGING IN…' : 'LOG IN'}
              </button>
            </form>
          ) : regStep === 'otp' ? (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="text-center">
                <h3 className="text-lg font-bold text-white">Verify your phone</h3>
                <p className="text-sm text-gray-400 mt-1">Enter the 6-digit code we sent to <span className="text-gray-200">{phone || 'your number'}</span></p>
              </div>
              <input
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="______"
                required
                className="w-full rounded-xl px-4 py-3 text-center text-2xl tracking-[0.5em] font-mono text-white placeholder-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                style={INPUT_STYLE}
              />
              <p className="text-center text-xs text-gray-500">{pendingToken ? 'Demo mode - enter any 6 digits to continue' : 'Enter the code sent to your phone'}</p>
              {error && <p className="text-red-400 text-xs bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">{error}</p>}
              <button type="submit" className="w-full py-3.5 rounded-xl font-extrabold text-sm tracking-widest transition-opacity hover:opacity-90" style={{ background: '#22D3EE', color: '#0A0420' }}>
                VERIFY & CONTINUE
              </button>
              <button type="button" onClick={() => { setRegStep('form'); setError('') }} className="w-full text-xs text-gray-400 hover:text-white transition-colors">
                ← Back to edit details
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className={labelCasual}>Phone</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+254700000000" required className={inputCls} style={INPUT_STYLE} />
              </div>
              <div>
                <label className={labelCasual}>Full name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} required className={inputCls} style={INPUT_STYLE} />
              </div>
              <div>
                <label className={labelCasual}>Date of birth</label>
                <input type="date" value={dob} onChange={e => setDob(e.target.value)} required className={inputCls} style={INPUT_STYLE} />
              </div>
              <div>
                <label className={labelCasual}>Password (min 4 characters)</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={4} className={inputCls} style={INPUT_STYLE} />
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer text-sm text-gray-300">
                <input type="checkbox" checked={over18} onChange={e => setOver18(e.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-400 flex-shrink-0" />
                <span>I confirm I am 18 years or older</span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer text-sm text-gray-300">
                <input type="checkbox" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-400 flex-shrink-0" />
                <span>
                  I accept the{' '}
                  <button type="button" onClick={() => setShowTerms(true)} className="text-cyan-400 font-semibold hover:text-cyan-300 underline underline-offset-2">
                    Terms &amp; Conditions
                  </button>
                </span>
              </label>

              {error && <p className="text-red-400 text-xs bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">{error}</p>}
              <button type="submit" disabled={loading || !over18 || !acceptedTerms} className="w-full py-3.5 rounded-xl font-extrabold text-sm tracking-widest transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: '#22D3EE', color: '#0A0420' }}>
                {loading ? 'CREATING…' : 'REGISTER'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>

    {showTerms && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}
        onClick={e => { if (e.target === e.currentTarget) setShowTerms(false) }}
      >
        <div className="relative w-full max-w-lg max-h-[85vh] rounded-2xl flex flex-col overflow-hidden" style={{ background: CARD_BG, border: '1px solid rgba(255,255,255,0.18)' }}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
            <h3 className="font-bold text-white">Terms &amp; Conditions</h3>
            <button onClick={() => setShowTerms(false)} className="text-gray-400 hover:text-white transition-colors"><X size={18} /></button>
          </div>
          <div className="overflow-y-auto px-5 py-4">
            <TermsContent />
          </div>
          <div className="px-5 py-4 border-t border-white/10 flex-shrink-0">
            <button
              onClick={() => { setAcceptedTerms(true); setShowTerms(false) }}
              className="w-full py-3 rounded-xl font-extrabold text-sm tracking-widest transition-opacity hover:opacity-90"
              style={{ background: '#22D3EE', color: '#0A0420' }}
            >
              ACCEPT &amp; CLOSE
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
