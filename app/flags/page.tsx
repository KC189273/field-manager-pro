'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
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
  resolution_note: string | null
  resolved_by_name: string | null
  resolved_at: string | null
}

const FLAG_LABELS: Record<string, string> = {
  missing_clock_out: 'Missing Clock-Out',
  missing_clock_in: 'Missing Clock-In',
  no_activity: 'No Activity',
  overtime: 'Overtime',
  schedule_no_opener: 'No Opener Scheduled',
  schedule_no_closer: 'No Closer Scheduled',
  schedule_gap: 'Coverage Gap',
  schedule_overlap: 'Double-Booked Employee',
  schedule_overtime: 'Scheduled Overtime',
  break_long: 'Long Break',
  break_multiple: 'Multiple Breaks',
  auto_clock_out: 'Auto Clock-Out',
  late_clock_in: 'Late Clock-In',
}

const FLAG_COLORS: Record<string, string> = {
  missing_clock_out: 'text-red-400 bg-red-900/30 border-red-800/50',
  missing_clock_in: 'text-red-400 bg-red-900/30 border-red-800/50',
  no_activity: 'text-gray-400 bg-gray-800/50 border-gray-700/50',
  overtime: 'text-orange-400 bg-orange-900/30 border-orange-800/50',
  schedule_no_opener: 'text-amber-400 bg-amber-900/30 border-amber-800/50',
  schedule_no_closer: 'text-amber-400 bg-amber-900/30 border-amber-800/50',
  schedule_gap: 'text-amber-400 bg-amber-900/30 border-amber-800/50',
  schedule_overlap: 'text-red-400 bg-red-900/30 border-red-800/50',
  schedule_overtime: 'text-orange-400 bg-orange-900/30 border-orange-800/50',
  break_long: 'text-yellow-400 bg-yellow-900/30 border-yellow-800/50',
  break_multiple: 'text-yellow-400 bg-yellow-900/30 border-yellow-800/50',
  auto_clock_out: 'text-blue-400 bg-blue-900/30 border-blue-800/50',
  late_clock_in: 'text-rose-400 bg-rose-900/30 border-rose-800/50',
}

export default function FlagsPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [flags, setFlags] = useState<Flag[]>([])
  const [showResolved, setShowResolved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState<string | null>(null)
  const [activeFlag, setActiveFlag] = useState<Flag | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')

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

  const isManager = session && (session.role === 'manager' || session.role === 'ops_manager' || session.role === 'owner' || session.role === 'sales_director' || session.role === 'developer')

  function openResolve(flag: Flag) {
    setActiveFlag(flag)
    setResolutionNote('')
  }

  async function resolve(flagId: string) {
    setResolving(flagId)
    const res = await fetch('/api/flags', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flagId, note: resolutionNote }),
    })
    if (res.ok) {
      setFlags(prev => prev.filter(f => f.id !== flagId))
      setActiveFlag(null)
    }
    setResolving(null)
  }

  async function resolveAndGo(flag: Flag) {
    setResolving(flag.id)
    const res = await fetch('/api/flags', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flagId: flag.id, note: resolutionNote }),
    })
    if (res.ok) {
      setFlags(prev => prev.filter(f => f.id !== flag.id))
    }
    setResolving(null)
    router.push(`/timecards?userId=${flag.user_id}`)
  }

  // FLAG_COLORS defined at module level

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
              const colorClass = FLAG_COLORS[flag.type] ?? 'text-gray-400 bg-gray-900 border-gray-800'
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
                      {showResolved && flag.resolution_note && (
                        <div className="mt-2 bg-black/20 rounded-lg px-3 py-2">
                          <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide mb-0.5">Resolution Note</p>
                          <p className="text-xs text-gray-300">{flag.resolution_note}</p>
                          {flag.resolved_by_name && (
                            <p className="text-[10px] text-gray-600 mt-1">— {flag.resolved_by_name}</p>
                          )}
                        </div>
                      )}
                    </div>
                    {isManager && !showResolved && (
                      <button
                        onClick={() => openResolve(flag)}
                        className="flex-shrink-0 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Resolve modal */}
      {activeFlag && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setActiveFlag(null)}
        >
          <div
            className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6"
            onClick={e => e.stopPropagation()}
          >
            {/* Flag type badge */}
            <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border mb-4 ${FLAG_COLORS[activeFlag.type] ?? 'text-gray-400 bg-gray-900 border-gray-800'}`}>
              {FLAG_LABELS[activeFlag.type] ?? activeFlag.type}
            </div>

            <h2 className="text-lg font-bold text-white mb-1">{activeFlag.full_name}</h2>
            <p className="text-sm text-gray-400 mb-1">
              {new Date(activeFlag.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <p className="text-sm text-gray-300 mb-4">{activeFlag.detail}</p>

            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1.5">Resolution Note <span className="text-gray-600">(optional)</span></label>
              <textarea
                rows={3}
                placeholder="e.g. Employee called in sick on Wednesday — hours came in under 40 without that day."
                value={resolutionNote}
                onChange={e => setResolutionNote(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none"
              />
            </div>

            <div className="space-y-2">
              {/* Primary: go to timecard and resolve */}
              <button
                onClick={() => resolveAndGo(activeFlag)}
                disabled={resolving === activeFlag.id}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                {resolving === activeFlag.id ? 'Opening…' : 'Go to Timecard & Resolve'}
              </button>

              {/* Secondary: mark resolved without navigating */}
              <button
                onClick={() => resolve(activeFlag.id)}
                disabled={resolving === activeFlag.id}
                className="w-full bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                {resolving === activeFlag.id ? '…' : 'Mark Resolved (already handled)'}
              </button>

              <button
                onClick={() => setActiveFlag(null)}
                className="w-full text-gray-500 hover:text-gray-300 text-sm py-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
