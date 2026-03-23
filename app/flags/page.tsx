'use client'

import { useState, useEffect } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'developer'
}

interface Flag {
  id: string
  user_id: string
  type: string
  date: string
  detail: string
  resolved: boolean
  full_name: string
  username: string
  created_at: string
}

const FLAG_LABELS: Record<string, string> = {
  missing_clockout: 'Missing Clock-Out',
  no_activity: 'No Activity',
  overtime: 'Overtime',
}

export default function FlagsPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [flags, setFlags] = useState<Flag[]>([])
  const [showResolved, setShowResolved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState<string | null>(null)

  async function loadFlags(resolved: boolean) {
    setLoading(true)
    const res = await fetch(`/api/flags?resolved=${resolved}`)
    if (res.ok) {
      const data = await res.json()
      setFlags(data.flags)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
  }, [])

  useEffect(() => { loadFlags(showResolved) }, [showResolved])

  const isManager = session && (session.role === 'manager' || session.role === 'ops_manager' || session.role === 'developer')

  async function resolve(flagId: string) {
    setResolving(flagId)
    const res = await fetch('/api/flags', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flagId }),
    })
    if (res.ok) {
      setFlags(prev => prev.filter(f => f.id !== flagId))
    }
    setResolving(null)
  }

  const flagColors: Record<string, string> = {
    missing_clockout: 'text-amber-400 bg-amber-950 border-amber-800',
    no_activity: 'text-blue-400 bg-blue-950 border-blue-800',
    overtime: 'text-red-400 bg-red-950 border-red-800',
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="px-4 pt-6 max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Flags</h1>
          <div className="flex rounded-xl overflow-hidden border border-gray-800">
            <button
              onClick={() => setShowResolved(false)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${!showResolved ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Open
            </button>
            <button
              onClick={() => setShowResolved(true)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${showResolved ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Resolved
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-gray-500 py-12">Loading…</div>
        ) : flags.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            {showResolved ? 'No resolved flags' : 'No open flags'}
          </div>
        ) : (
          <div className="space-y-3">
            {flags.map(flag => {
              const colorClass = flagColors[flag.type] ?? 'text-gray-400 bg-gray-900 border-gray-800'
              return (
                <div key={flag.id} className={`rounded-2xl p-4 border ${colorClass}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{FLAG_LABELS[flag.type] ?? flag.type}</p>
                      {isManager && <p className="text-xs opacity-70 mt-0.5">{flag.full_name}</p>}
                      <p className="text-xs opacity-60 mt-0.5">
                        {new Date(flag.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </p>
                      <p className="text-xs text-gray-300 mt-1.5">{flag.detail}</p>
                    </div>
                    {isManager && !showResolved && (
                      <button
                        onClick={() => resolve(flag.id)}
                        disabled={resolving === flag.id}
                        className="flex-shrink-0 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {resolving === flag.id ? '…' : 'Resolve'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
