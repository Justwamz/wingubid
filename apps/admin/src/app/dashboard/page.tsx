'use client'
import { useEffect, useState } from 'react'
import { isAuthenticated, clearToken } from '@/lib/auth'
import { useRouter } from 'next/navigation'

export default function AdminDashboardPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login')
    } else {
      setReady(true)
    }
  }, [router])

  function handleLogout() {
    clearToken()
    router.push('/login')
  }

  if (!ready) return null

  return (
    <main className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <button
          onClick={handleLogout}
          className="rounded bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600"
        >
          Log out
        </button>
      </div>
      <p className="text-gray-400">Welcome to the back-office. More features coming in Phase 3.</p>
    </main>
  )
}
