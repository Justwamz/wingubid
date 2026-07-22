'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/apiFetch'
import { getDeviceId } from '@/lib/device'
import { Gift } from 'lucide-react'

interface Campaign {
  id: string
  key: string
  name: string
  description: string
  amountCents: number
  claimable: boolean
}

interface AvailableResponse {
  campaigns: Campaign[]
}

interface ClaimResponse {
  ok: boolean
  amountCents: number
}

export default function RewardsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [claimError, setClaimError] = useState<Record<string, string>>({})
  const [claimSuccess, setClaimSuccess] = useState<Record<string, number>>({})

  const [promoCode, setPromoCode] = useState('')
  const [promoSubmitting, setPromoSubmitting] = useState(false)
  const [promoError, setPromoError] = useState('')
  const [promoSuccess, setPromoSuccess] = useState<number | null>(null)

  async function fetchAvailable() {
    try {
      const data = await apiFetch<AvailableResponse>('/bonuses/available')
      setCampaigns(data.campaigns ?? [])
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }

  useEffect(() => {
    let cancelled = false
    apiFetch<AvailableResponse>('/bonuses/available')
      .then(data => { if (!cancelled) setCampaigns(data.campaigns ?? []) })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  async function handleClaim(campaign: Campaign) {
    setClaimingId(campaign.id)
    setClaimError(prev => ({ ...prev, [campaign.id]: '' }))
    try {
      const data = await apiFetch<ClaimResponse>('/bonuses/claim', {
        method: 'POST',
        body: JSON.stringify({ campaignId: campaign.id, deviceId: getDeviceId() }),
      })
      setClaimSuccess(prev => ({ ...prev, [campaign.id]: data.amountCents }))
      window.dispatchEvent(new Event('balanceRefresh'))
      setCampaigns(prev => prev.filter(c => c.id !== campaign.id))
    } catch (e: unknown) {
      setClaimError(prev => ({
        ...prev,
        [campaign.id]: e instanceof Error ? e.message : 'Something went wrong. Please try again in a moment.',
      }))
    } finally {
      setClaimingId(null)
    }
  }

  async function handleApplyCode() {
    const code = promoCode.trim()
    if (!code) return
    setPromoSubmitting(true)
    setPromoError('')
    try {
      const data = await apiFetch<ClaimResponse>('/bonuses/claim', {
        method: 'POST',
        body: JSON.stringify({ code, deviceId: getDeviceId() }),
      })
      setPromoSuccess(data.amountCents)
      window.dispatchEvent(new Event('balanceRefresh'))
      setPromoCode('')
      fetchAvailable()
    } catch (e: unknown) {
      setPromoError(e instanceof Error ? e.message : 'Something went wrong. Please try again in a moment.')
    } finally {
      setPromoSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Gift size={24} className="text-accent-cyan" />
        <h1 className="text-2xl font-extrabold font-mono text-white">Rewards</h1>
      </div>

      <div className="bg-game-card border border-game-border rounded-2xl p-5 space-y-3">
        <p className="text-white font-bold text-sm">Have a promo code?</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={promoCode}
            onChange={e => setPromoCode(e.target.value)}
            placeholder="Enter promo code"
            className="flex-1 bg-black/30 border border-game-border rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:border-accent-cyan"
          />
          <button
            onClick={handleApplyCode}
            disabled={promoSubmitting || !promoCode.trim()}
            className="px-5 py-2.5 rounded-xl font-bold text-sm disabled:opacity-40 transition-all whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg, #00C896, #00F2FE)', color: '#0a0a0a' }}
          >
            {promoSubmitting ? 'Applying...' : 'Apply'}
          </button>
        </div>
        {promoError && <p className="text-warning-coral text-sm">{promoError}</p>}
        {promoSuccess !== null && (
          <p className="text-emerald-400 text-sm font-bold">
            Bonus claimed! KES {(promoSuccess / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })} has been credited to your account.
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading rewards...</p>
      ) : loadError ? (
        <div className="bg-game-card border border-game-border rounded-2xl p-6 text-center">
          <p className="text-warning-coral text-sm">We couldn't load your rewards. Please try again in a moment.</p>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="bg-game-card border border-game-border rounded-2xl p-6 text-center">
          <p className="text-gray-500 text-sm">No rewards available right now. Check back soon.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {campaigns.map(campaign => (
            <div
              key={campaign.id}
              className="bg-game-card border border-game-border rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
            >
              <div className="flex-1 space-y-1">
                <p className="text-white font-bold">{campaign.name}</p>
                <p className="text-gray-400 text-sm">{campaign.description}</p>
                <p className="text-accent-cyan font-mono font-bold text-sm">
                  KES {(campaign.amountCents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                </p>
                {claimError[campaign.id] && (
                  <p className="text-warning-coral text-sm">{claimError[campaign.id]}</p>
                )}
              </div>
              <button
                onClick={() => handleClaim(campaign)}
                disabled={!campaign.claimable || claimingId === campaign.id}
                className="px-5 py-2.5 rounded-xl font-bold text-sm disabled:opacity-40 transition-all whitespace-nowrap"
                style={{ background: 'linear-gradient(135deg, #00C896, #00F2FE)', color: '#0a0a0a' }}
              >
                {claimingId === campaign.id ? 'Claiming...' : 'Claim'}
              </button>
            </div>
          ))}
        </div>
      )}

      {Object.entries(claimSuccess).map(([id, amountCents]) => (
        <div key={id} className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 text-center">
          <p className="text-emerald-400 text-sm font-bold">
            Bonus claimed! KES {(amountCents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })} has been credited to your account.
          </p>
        </div>
      ))}
    </div>
  )
}
