'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    phone: '', name: '', country: 'KE', date_of_birth: '', password: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { data, error: err } = await apiFetch<{ access_token?: string; message?: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(form),
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    if (data?.access_token) {
      localStorage.setItem('access_token', data.access_token)
      router.push('/lobby')
    } else {
      router.push(`/verify?phone=${encodeURIComponent(form.phone)}`)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-3xl font-bold text-center">Create Account</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {([
            ['phone', 'tel', 'Phone (+254700000000)'],
            ['name', 'text', 'Full name'],
            ['date_of_birth', 'date', 'Date of birth'],
            ['password', 'password', 'Password (min 8 chars)'],
          ] as [keyof typeof form, string, string][]).map(([field, type, placeholder]) => (
            <div key={field}>
              <label className="block text-sm text-gray-400 mb-1">{placeholder}</label>
              <input
                type={type}
                value={form[field]}
                onChange={update(field)}
                placeholder={type !== 'date' && type !== 'password' ? placeholder : undefined}
                className="w-full rounded bg-gray-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-emerald-500"
                required
              />
            </div>
          ))}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Country</label>
            <select
              value={form.country}
              onChange={update('country')}
              className="w-full rounded bg-gray-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="KE">Kenya</option>
              <option value="UG">Uganda</option>
              <option value="TZ">Tanzania</option>
              <option value="RW">Rwanda</option>
            </select>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-emerald-600 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading ? 'Registering…' : 'Register'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-400">
          Have an account?{' '}
          <Link href="/login" className="text-emerald-400 hover:underline">Log in</Link>
        </p>
      </div>
    </main>
  )
}
