'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { saveToken } from '@/lib/auth'

interface LoginResponse {
  access_token: string
  admin: { name: string; role: string }
  mustChangePassword?: boolean
}

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { data, error: err } = await apiFetch<LoginResponse>('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    saveToken(data!.access_token)
    router.push(data!.mustChangePassword ? '/change-password' : '/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-3xl font-bold text-center">Admin</h1>
        <p className="mb-8 text-center text-gray-400 text-sm">Back-office login</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded bg-gray-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded bg-gray-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-blue-600 py-2 font-semibold hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>
      </div>
    </main>
  )
}
