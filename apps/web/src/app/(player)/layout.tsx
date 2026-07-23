'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { isAuthenticated, clearToken } from '@/lib/auth'
import { apiFetch } from '@/lib/api'
import { Gamepad2, CreditCard, User, LogOut, Gift } from 'lucide-react'

interface PlayerProfile {
  name: string
  currency: string
  wallet: { balance: number; bonus_balance: number }
}

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [balanceFlash, setBalanceFlash] = useState(false)
  const prevBalance = useRef<number | null>(null)
  const prevBonusRef = useRef<number | null>(null)
  const [bonusToast, setBonusToast] = useState<string | null>(null)

  useEffect(() => {
    if (profile === null) return
    const current = profile.wallet.balance
    if (prevBalance.current !== null && prevBalance.current !== current) {
      setBalanceFlash(true)
      const t = setTimeout(() => setBalanceFlash(false), 700)
      prevBalance.current = current
      return () => clearTimeout(t)
    }
    prevBalance.current = current
  }, [profile])

  useEffect(() => {
    if (profile === null) { prevBonusRef.current = null; return }
    const current = profile.wallet.bonus_balance
    if (prevBonusRef.current !== null && current > prevBonusRef.current) {
      setBonusToast('Bonus added to your account!')
    }
    prevBonusRef.current = current
  }, [profile?.wallet.bonus_balance])

  useEffect(() => {
    if (bonusToast === null) return
    const t = setTimeout(() => setBonusToast(null), 4000)
    return () => clearTimeout(t)
  }, [bonusToast])

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/?login=true'); return }
    const fetchProfile = () => apiFetch<PlayerProfile>('/player/me', { cache: 'no-store' }).then(({ data }) => data && setProfile(data))
    fetchProfile()
    window.addEventListener('balanceRefresh', fetchProfile)
    return () => window.removeEventListener('balanceRefresh', fetchProfile)
  }, [router])

  function handleLogout() {
    apiFetch('/auth/logout', { method: 'POST' })
    clearToken()
    router.replace('/?login=true')
  }

  const navLinks: { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean }[] = [
    { href: '/games', label: 'Games', icon: <Gamepad2 size={18} />, match: (p: string) => p.startsWith('/games') },
    { href: '/wallet/deposit', label: 'Deposit', icon: <CreditCard size={18} />, match: (p: string) => p === '/wallet/deposit' },
    { href: '/rewards', label: 'Rewards', icon: <Gift size={18} />, match: (p: string) => p === '/rewards' },
    { href: '/dashboard', label: 'Profile', icon: <User size={18} />, match: (p: string) => p === '/dashboard' },
  ]

  return (
    <div className="min-h-screen bg-game-bg text-white flex flex-col">
      {/* Top header */}
      <header className="sticky top-0 z-40 bg-game-card border-b border-game-border">
        <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/games" className="flex-shrink-0">
            <img src="/wingubet-logo.png" alt="WinguBet" style={{ height: '72px', width: 'auto' }} />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map(l => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  l.match(pathname) ? 'bg-accent-cyan/10 text-accent-cyan' : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Balance + logout */}
          <div className="flex items-center gap-3">
            {profile && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 bg-game-bg border border-game-border rounded-lg px-3 py-1.5">
                  <span className="text-gray-400 text-xs hidden sm:block">{profile.currency}</span>
                  <span className={`font-mono font-bold text-sm transition-colors duration-300 ${balanceFlash ? 'text-yellow-300' : 'text-accent-cyan'}`}>
                    {(profile.wallet.balance / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                {profile.wallet.bonus_balance > 0 && (
                  <div className="flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-lg px-3 py-1.5">
                    <span className="text-violet-300 text-xs hidden sm:block">Bonus</span>
                    <span className="font-mono font-bold text-sm text-violet-300">
                      {(profile.wallet.bonus_balance / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <Link
                  href="/wallet/deposit"
                  className="px-3 py-1.5 rounded-lg bg-accent-cyan text-black font-bold text-xs hover:brightness-110 transition-all whitespace-nowrap"
                >
                  + Top Up
                </Link>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="hidden md:block text-xs text-gray-500 hover:text-white transition-colors px-2 py-1.5"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 pb-16 md:pb-0">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-game-card border-t border-game-border flex z-40">
        {navLinks.map(l => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex-1 flex flex-col items-center py-2.5 text-xs font-mono gap-1 transition-colors ${
              l.match(pathname) ? 'text-accent-cyan' : 'text-gray-500'
            }`}
          >
            {l.icon}
            {l.label.toUpperCase()}
          </Link>
        ))}
        <button
          onClick={handleLogout}
          className="flex-1 flex flex-col items-center py-2.5 text-xs font-mono gap-1 text-gray-500"
        >
          <LogOut size={18} />
          LOGOUT
        </button>
      </nav>

      {/* Bonus toast */}
      {bonusToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-game-card border border-violet-500/30 rounded-full px-4 py-2.5 shadow-lg">
          <Gift size={16} className="text-violet-300" />
          <span className="text-sm font-semibold text-white">{bonusToast}</span>
        </div>
      )}
    </div>
  )
}
