'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { refreshBalance } from '@/lib/auth'
import { CheckCircle2 } from 'lucide-react'

const PRESET_AMOUNTS = [500, 1000, 2000, 5000, 10000]

interface Withdrawal {
  id: string
  amount: number
  status: string
  created_at: string
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    completed: 'bg-green-900/50 text-green-400 border-green-700/50',
    pending:   'bg-yellow-900/50 text-yellow-400 border-yellow-700/50',
    failed:    'bg-red-900/50 text-red-400 border-red-700/50',
  }
  return map[status] ?? 'bg-gray-800 text-gray-400 border-gray-700'
}

export default function WithdrawPage() {
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<{ balance: number; withdrawn: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<Withdrawal[]>([])

  async function loadHistory() {
    const { data } = await apiFetch<{ withdrawals: Withdrawal[] }>('/wallet/withdrawals')
    if (data) setHistory(data.withdrawals)
  }

  useEffect(() => { loadHistory() }, [])

  async function handleWithdraw() {
    const parsed = parseInt(amount, 10)
    if (!parsed || parsed < 100) {
      setError('Minimum withdrawal is KES 100')
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: apiError } = await apiFetch<{ balance: number; withdrawn: number }>(
      '/wallet/demo-withdraw',
      { method: 'POST', body: JSON.stringify({ amount: parsed * 100 }) },
    )
    setLoading(false)
    if (apiError) {
      setError(apiError.message ?? "We couldn't process your withdrawal. Please try again.")
      return
    }
    if (data) {
      refreshBalance()
      setSuccess(data)
      setAmount('')
      loadHistory()
    }
  }

  if (success) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 flex flex-col items-center gap-6 text-center">
        <div className="w-20 h-20 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
          <CheckCircle2 size={48} className="text-green-400" />
        </div>
        <div>
          <p className="text-gray-400 text-sm">Withdrawal submitted</p>
          <p className="text-4xl font-mono font-bold text-accent-cyan mt-1">
            KES {(success.withdrawn / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <p className="text-gray-400 text-sm">
          Remaining balance:{' '}
          <span className="text-white font-mono">
            KES {(success.balance / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </span>
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setSuccess(null)}
            className="px-6 py-2.5 rounded-lg border border-game-border text-sm hover:bg-white/5 transition-colors"
          >
            Withdraw Again
          </button>
          <Link
            href="/games"
            className="px-6 py-2.5 rounded-lg bg-accent-cyan text-black font-bold text-sm hover:brightness-110 transition"
          >
            Play Now
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/games" className="text-gray-500 hover:text-white text-sm flex items-center gap-1 mb-6 transition-colors w-fit">
        ← Back to Games
      </Link>

      <h1 className="text-2xl font-bold mb-1">Withdraw Funds</h1>
      <p className="text-gray-400 text-sm mb-8">Withdraw winnings to your mobile money account</p>

      {/* M-Pesa - coming soon */}
      <div className="rounded-xl border border-game-border bg-game-card p-6 mb-4 opacity-60 select-none">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-600/20 border border-green-600/30 flex items-center justify-center">
              <span className="text-green-400 font-bold text-xs">M</span>
            </div>
            <div>
              <p className="font-semibold text-sm">M-Pesa</p>
              <p className="text-gray-500 text-xs">Safaricom mobile money</p>
            </div>
          </div>
          <span className="text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-full px-3 py-1">
            Coming Soon
          </span>
        </div>
        <p className="text-gray-500 text-xs">Instant payout to your M-Pesa number. Minimum KES 100.</p>
      </div>

      {/* MTN / Airtel - coming soon */}
      <div className="rounded-xl border border-game-border bg-game-card p-6 mb-8 opacity-60 select-none">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center">
              <span className="text-yellow-400 font-bold text-xs">M</span>
            </div>
            <div>
              <p className="font-semibold text-sm">MTN / Airtel Money</p>
              <p className="text-gray-500 text-xs">Mobile money for other networks</p>
            </div>
          </div>
          <span className="text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-full px-3 py-1">
            Coming Soon
          </span>
        </div>
        <p className="text-gray-500 text-xs">Available in Kenya, Uganda, Tanzania and more.</p>
      </div>

      {/* Demo Withdrawal */}
      <div className="rounded-xl border border-accent-cyan/30 bg-game-card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 border border-accent-cyan/30 flex items-center justify-center">
            <span className="text-accent-cyan font-bold text-sm">D</span>
          </div>
          <div>
            <p className="font-semibold text-sm text-accent-cyan">Demo Withdrawal</p>
            <p className="text-gray-500 text-xs">Instant · Minimum KES 100</p>
          </div>
        </div>

        <p className="text-xs text-gray-400 mb-3">Select amount (KES)</p>
        <div className="grid grid-cols-5 gap-2 mb-4">
          {PRESET_AMOUNTS.map(a => (
            <button
              key={a}
              onClick={() => setAmount(String(a))}
              className={`py-2 rounded-lg text-xs font-mono font-semibold border transition-colors whitespace-nowrap ${
                amount === String(a)
                  ? 'bg-accent-cyan/20 border-accent-cyan text-accent-cyan'
                  : 'border-game-border text-gray-300 hover:border-gray-500 hover:text-white'
              }`}
            >
              {a >= 1000 ? `${a / 1000}K` : a}
            </button>
          ))}
        </div>

        <div className="relative mb-4">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">KES</span>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Enter custom amount"
            min={100}
            className="w-full bg-game-bg border border-game-border rounded-lg pl-12 pr-4 py-3 text-sm font-mono focus:outline-none focus:border-accent-cyan/50 placeholder-gray-600"
          />
        </div>

        {error && <p className="text-warning-coral text-xs mb-3">{error}</p>}

        <button
          onClick={handleWithdraw}
          disabled={loading || !amount}
          className="w-full py-3 rounded-lg bg-accent-cyan text-black font-bold text-sm hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Processing…' : 'Withdraw Now'}
        </button>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Recent Withdrawals</h2>
          <div className="space-y-2">
            {history.map(w => (
              <div key={w.id} className="flex items-center justify-between bg-game-card border border-game-border rounded-xl px-4 py-3">
                <div>
                  <p className="text-white font-mono font-semibold text-sm">
                    KES {(w.amount / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-gray-500 text-xs mt-0.5">{new Date(w.created_at).toLocaleString()}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusBadge(w.status)}`}>
                  {w.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
