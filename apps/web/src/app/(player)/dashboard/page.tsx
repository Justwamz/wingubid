'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { clearToken } from '@/lib/auth'
import { useRouter } from 'next/navigation'

interface PlayerProfile {
  name: string
  phone: string
  country: string
  currency: string
  wallet: { balance: number; bonus_balance: number }
}

export default function DashboardPage() {
  const router = useRouter()
  const [player, setPlayer] = useState<PlayerProfile | null>(null)

  useEffect(() => {
    apiFetch<PlayerProfile>('/player/me').then(({ data }) => {
      if (data) setPlayer(data)
    })
  }, [])

  function handleLogout() {
    apiFetch('/auth/logout', { method: 'POST' })
    clearToken()
    router.push('/login')
  }

  if (!player) return <p className="p-8 text-gray-400">Loading…</p>

  return (
    <main className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Welcome, {player.name}</h1>
        <button
          onClick={handleLogout}
          className="rounded bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600"
        >
          Log out
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 max-w-md">
        <div className="rounded-lg bg-gray-800 p-4">
          <p className="text-sm text-gray-400">Balance</p>
          <p className="text-2xl font-bold mt-1">
            {player.currency} {(player.wallet.balance / 100).toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg bg-gray-800 p-4">
          <p className="text-sm text-gray-400">Bonus</p>
          <p className="text-2xl font-bold mt-1">
            {player.currency} {(player.wallet.bonus_balance / 100).toFixed(2)}
          </p>
        </div>
      </div>
    </main>
  )
}
