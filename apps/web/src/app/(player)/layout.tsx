'use client'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { isAuthenticated } from '@/lib/auth'

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    if (!isAuthenticated()) router.replace('/login')
  }, [router])
  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex-1 pb-16">{children}</div>
      <nav className="fixed bottom-0 left-0 right-0 bg-game-card border-t border-game-border flex">
        <Link
          href="/games"
          className={`flex-1 flex flex-col items-center py-3 text-xs font-mono gap-1 ${pathname.startsWith('/games') ? 'text-accent-cyan' : 'text-gray-400'}`}
        >
          <span className="text-xl">🎮</span>
          GAMES
        </Link>
        <Link
          href="/dashboard"
          className={`flex-1 flex flex-col items-center py-3 text-xs font-mono gap-1 ${pathname === '/dashboard' ? 'text-accent-cyan' : 'text-gray-400'}`}
        >
          <span className="text-xl">👤</span>
          PROFILE
        </Link>
      </nav>
    </div>
  )
}
