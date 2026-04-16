'use client'

import { useState, useEffect } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'rdm' | 'developer'
}

interface Shift {
  id: string
  clock_in_at: string
  clock_out_at: string | null
  clock_in_address: string | null
  clock_out_address: string | null
  duration_seconds: number
  is_manual: boolean
  manual_note: string | null
  manual_by_name: string | null
  full_name: string
}

interface User {
  id: string
  full_name: string
  username: string
}

const isManagerRole = (role: string) => role === 'manager' || role === 'ops_manager' || role === 'developer'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago' })
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function TimeHistoryPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [selectedUser, setSelectedUser] = useState<string>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(s => {
      setSession(s)
      if (!isManagerRole(s.role)) loadShifts(s.id)
    })
  }, [])

  useEffect(() => {
    if (session && isManagerRole(session.role)) {
      fetch('/api/team/users').then(r => r.json()).then(d => {
        if (d.users) setUsers(d.users.filter((u: { role: string }) => u.role === 'employee'))
      })
    }
  }, [session])

  async function loadShifts(userId?: string) {
    setLoading(true)
    const params = new URLSearchParams()
    if (userId) params.set('userId', userId)
    if (from) params.set('from', from)
    if (to) params.set('to', to + 'T23:59:59')
    const res = await fetch(`/api/shifts?${params}`)
    if (res.ok) {
      const data = await res.json()
      setShifts(data.shifts)
    }
    setLoading(false)
  }

  function handleSearch() {
    loadShifts(selectedUser || undefined)
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="px-4 pt-6 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6">Time History</h1>

        {/* Filters (managers/dev only) */}
        {session && isManagerRole(session.role) && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-5 space-y-3">
            <select
              value={selectedUser}
              onChange={e => setSelectedUser(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">All employees</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input
                  type="date"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input
                  type="date"
                  value={to}
                  onChange={e => setTo(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>
            <button
              onClick={handleSearch}
              className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
            >
              Search
            </button>
          </div>
        )}

        {/* Shift list */}
        {loading ? (
          <div className="text-center text-gray-500 py-12">Loading…</div>
        ) : shifts.length === 0 ? (
          <div className="text-center text-gray-500 py-12">No shifts found</div>
        ) : (
          <div className="space-y-3">
            {shifts.map(shift => (
              <div key={shift.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-white font-semibold">{formatDate(shift.clock_in_at)}</p>
                    {session && isManagerRole(session.role) && (
                      <p className="text-violet-400 text-xs font-medium">{shift.full_name}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-white font-bold">{formatDuration(Number(shift.duration_seconds))}</p>
                    {!shift.clock_out_at && <p className="text-green-400 text-xs">Active</p>}
                  </div>
                </div>
                <div className="text-sm text-gray-400 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                    <span>{formatTime(shift.clock_in_at)}{shift.clock_in_address ? ` · ${shift.clock_in_address}` : ''}</span>
                  </div>
                  {shift.clock_out_at && (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                      <span>{formatTime(shift.clock_out_at)}{shift.clock_out_address ? ` · ${shift.clock_out_address}` : ''}</span>
                    </div>
                  )}
                </div>
                {shift.is_manual && (
                  <div className="mt-2 bg-amber-950/50 border border-amber-800 rounded-lg px-3 py-2">
                    <p className="text-amber-400 text-xs font-semibold">Manual entry by {shift.manual_by_name}</p>
                    {shift.manual_note && <p className="text-gray-400 text-xs mt-0.5">{shift.manual_note}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
