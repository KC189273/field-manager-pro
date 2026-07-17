'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

type Step = 'code' | 'info'

export default function CustomerSignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <CustomerSignupInner />
    </Suspense>
  )
}

function CustomerSignupInner() {
  const searchParams = useSearchParams()
  const [step, setStep] = useState<Step>('code')
  const [code, setCode] = useState('')

  // Auto-fill code from QR scan URL param
  useEffect(() => {
    const c = searchParams.get('code')
    if (c && c.length === 4) {
      setCode(c.toUpperCase())
      // Auto-lookup
      fetch(`/api/barbershop/lookup?code=${c.toUpperCase()}`).then(r => {
        if (!r.ok) return
        return r.json()
      }).then(d => {
        if (d?.shop) {
          setShopName(d.shop.shop_name)
          setShopAddress(d.shop.address ?? '')
          setOrgId(d.shop.org_id)
          setStep('info')
        }
      }).catch(() => {})
    }
  }, [searchParams])
  const [shopName, setShopName] = useState('')
  const [shopAddress, setShopAddress] = useState('')
  const [orgId, setOrgId] = useState('')
  const [form, setForm] = useState({ fullName: '', email: '', phone: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function lookupCode() {
    if (code.length !== 4) { setError('Code must be 4 characters'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/barbershop/lookup?code=${code.toUpperCase()}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Shop not found. Check your code.')
        return
      }
      const d = await res.json()
      setShopName(d.shop.shop_name)
      setShopAddress(d.shop.address ?? '')
      setOrgId(d.shop.org_id)
      setStep('info')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function createAccount() {
    if (!form.fullName.trim() || !form.email.trim()) {
      setError('Name and email are required.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/barbershop/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.toUpperCase(), ...form }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Failed to create account.')
        return
      }
      window.location.href = '/book'
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo area */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-blue-400">Book Your Appointment</h1>
          <p className="text-sm text-zinc-500 mt-1">Enter your barber&apos;s shop code to get started</p>
        </div>

        {step === 'code' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5 uppercase tracking-wide">Shop Code</label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase().slice(0, 4))}
                placeholder="ABCD"
                maxLength={4}
                className={inputCls + ' text-center text-2xl tracking-[0.5em] font-mono'}
                autoFocus
              />
            </div>

            {error && <p className="text-sm text-red-400 text-center">{error}</p>}

            <button onClick={lookupCode} disabled={loading || code.length !== 4}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
              {loading ? 'Looking up...' : 'Continue'}
            </button>

            <p className="text-center text-xs text-zinc-600">
              Ask your barber for the 4-letter code
            </p>
          </div>
        )}

        {step === 'info' && (
          <div className="space-y-4">
            {/* Shop found banner */}
            <div className="bg-zinc-900 border border-blue-500/30 rounded-xl px-4 py-3 text-center">
              <p className="text-sm font-semibold text-white">{shopName}</p>
              {shopAddress && <p className="text-xs text-zinc-500 mt-0.5">{shopAddress}</p>}
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Full Name *</label>
              <input type="text" value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                placeholder="Your full name" className={inputCls} autoFocus />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Email *</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="you@email.com" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Phone Number</label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="(555) 000-0000" className={inputCls} />
            </div>

            {error && <p className="text-sm text-red-400 text-center">{error}</p>}

            <button onClick={createAccount} disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
              {loading ? 'Continuing...' : 'Continue to Book'}
            </button>

            <button onClick={() => { setStep('code'); setError('') }}
              className="w-full text-xs text-zinc-500 hover:text-zinc-300 py-2">
              Back to code entry
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
