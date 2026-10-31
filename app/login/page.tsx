'use client'

import { useState, useEffect, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const REMEMBER_KEY = 'fmp-remember'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Demo modal state
  const [demoOpen, setDemoOpen] = useState(false)
  const [demoFirst, setDemoFirst] = useState('')
  const [demoLast, setDemoLast] = useState('')
  const [demoEmail, setDemoEmail] = useState('')
  const [demoLoading, setDemoLoading] = useState(false)
  const [demoError, setDemoError] = useState('')

  async function startDemo() {
    if (!demoFirst.trim() || !demoLast.trim() || !demoEmail.trim()) {
      setDemoError('Please fill in all fields'); return
    }
    setDemoLoading(true)
    setDemoError('')
    try {
      const res = await fetch('/api/demo/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: demoFirst, lastName: demoLast, email: demoEmail }),
      })
      const data = await res.json()
      if (res.ok) {
        window.location.href = '/demo'
      } else {
        setDemoError(data.error || 'Failed to start demo')
      }
    } catch {
      setDemoError('Network error')
    } finally {
      setDemoLoading(false)
    }
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY)
      if (saved) {
        const { username: u } = JSON.parse(saved)
        if (u) setUsername(u)
        setRememberMe(true)
      }
    } catch {}
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Login failed')
        return
      }
      if (rememberMe) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username }))
      } else {
        localStorage.removeItem(REMEMBER_KEY)
      }
      if (data.mustChangePassword) {
        window.location.href = '/change-password'
      } else if (data.role === 'customer') {
        window.location.href = '/book'
      } else if (data.role === 'barber') {
        window.location.href = '/barber-dashboard'
      } else if (data.role === 'shop_owner') {
        window.location.href = '/barber-dashboard'
      } else {
        window.location.href = '/dashboard'
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-violet-600 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Field Manager Pro</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-2xl p-6 border border-gray-800 space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-400 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              placeholder="your.username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={e => setRememberMe(e.target.checked)}
              className="accent-violet-500 w-4 h-4"
            />
            <span className="text-sm text-gray-400">Remember my username</span>
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
          <Link href="/forgot-password" className="block text-center text-gray-500 hover:text-gray-300 text-sm transition-colors">
            Forgot your password?
          </Link>
        </form>

        <button
          type="button"
          onClick={() => setDemoOpen(true)}
          className="block mt-4 w-full text-center bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-semibold rounded-xl py-3 text-sm transition-all cursor-pointer shadow-lg shadow-violet-900/30"
        >
          Try Demo — See It In Action
        </button>

        <button
          type="button"
          onClick={() => { window.location.href = '/get-started' }}
          className="block mt-2 w-full text-center bg-gray-900 border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-gray-300 font-semibold rounded-xl py-3 text-sm transition-colors cursor-pointer"
        >
          Get started for your business →
        </button>
      </div>

      {/* Demo modal */}
      {demoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={() => setDemoOpen(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-5">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-violet-600 mb-3">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-white">Try the Demo</h2>
              <p className="text-gray-400 text-xs mt-1">Explore all features with sample data. Just so we can reach you if you have questions:</p>
            </div>

            {demoError && (
              <div className="bg-red-900/30 border border-red-700 text-red-400 text-xs rounded-lg px-3 py-2 mb-3">{demoError}</div>
            )}

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input type="text" value={demoFirst} onChange={e => setDemoFirst(e.target.value)}
                  placeholder="First name" autoFocus
                  className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                <input type="text" value={demoLast} onChange={e => setDemoLast(e.target.value)}
                  placeholder="Last name"
                  className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <input type="email" value={demoEmail} onChange={e => setDemoEmail(e.target.value)}
                placeholder="Email address"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500" />
              <button onClick={startDemo} disabled={demoLoading}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 text-white font-semibold rounded-xl py-3 text-sm transition-colors">
                {demoLoading ? 'Starting demo…' : 'Start Exploring'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
