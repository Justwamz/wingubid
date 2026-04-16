'use client'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { saveToken } from '@/lib/auth'

function VerifyForm() {
  const router = useRouter()
  const params = useSearchParams()
  const phone = params.get('phone') ?? ''
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { data, error: err } = await apiFetch<{ access_token: string }>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    saveToken(data!.access_token)
    router.push('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-4 text-2xl font-bold text-center">Verify your phone</h1>
        <p className="mb-8 text-center text-gray-400 text-sm">
          Enter the 6-digit code sent to {phone}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            className="w-full rounded bg-gray-800 px-3 py-3 text-center text-2xl tracking-widest text-white outline-none focus:ring-2 focus:ring-emerald-500"
            required
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full rounded bg-emerald-600 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      </div>
    </main>
  )
}

export default function VerifyPage() {
  return <Suspense><VerifyForm /></Suspense>
}
