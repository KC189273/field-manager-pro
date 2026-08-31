'use client'

import { useState, useEffect } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_field_leader' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface TermEmployee {
  id: string
  full_name: string
  username: string
  email: string
  role: string
  manager_name: string | null
  created_at: string
  terminated_at: string | null
  shift_count: number
  total_hours: number
}

export default function TerminatedRecordsPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [employees, setEmployees] = useState<TermEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [reactivating, setReactivating] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(setSession)
    fetch('/api/terminated-records').then(r => r.json()).then(d => {
      setEmployees(d.employees ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function downloadRecord(emp: TermEmployee) {
    setDownloading(emp.id)
    setMessage(null)
    try {
      const res = await fetch('/api/terminated-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: emp.id }),
      })
      if (!res.ok) {
        const data = await res.json()
        setMessage({ text: data.error || 'Download failed', type: 'error' })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${emp.full_name.replace(/[^a-zA-Z0-9 ]/g, '')}_Timecard_Record.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      setMessage({ text: `Downloaded ${emp.full_name}'s records`, type: 'success' })
    } catch {
      setMessage({ text: 'Network error — try again', type: 'error' })
    } finally {
      setDownloading(null)
    }
  }

  async function reactivateEmployee(emp: TermEmployee) {
    if (!confirm(`Reactivate ${emp.full_name}? This will restore their account so they can log in again.`)) return
    setReactivating(emp.id)
    setMessage(null)
    try {
      const res = await fetch('/api/terminated-records', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: emp.id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setMessage({ text: data.error || 'Reactivation failed', type: 'error' })
        return
      }
      setEmployees(prev => prev.filter(e => e.id !== emp.id))
      setMessage({ text: `${emp.full_name} has been reactivated`, type: 'success' })
    } catch {
      setMessage({ text: 'Network error — try again', type: 'error' })
    } finally {
      setReactivating(null)
    }
  }

  const canReactivate = session?.role === 'owner' || session?.role === 'developer' || session?.role === 'ops_manager'

  const filtered = employees.filter(e =>
    e.full_name.toLowerCase().includes(search.toLowerCase()) ||
    e.email.toLowerCase().includes(search.toLowerCase()) ||
    (e.manager_name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-bold text-white">Terminated Employee Records</h1>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-lg">{employees.length} records</span>
        </div>
        <p className="text-gray-500 text-sm mb-5">Export complete timecard records with certification letter for terminated employees.</p>

        {message && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${
            message.type === 'success' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
          }`}>
            {message.text}
          </div>
        )}

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search by name, email, or manager..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
          />
        </div>

        {loading && <p className="text-gray-500 text-sm">Loading...</p>}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm">{search ? 'No matches found' : 'No terminated employees found'}</p>
          </div>
        )}

        <div className="space-y-3">
          {filtered.map(emp => (
            <div key={emp.id} className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-white font-semibold text-sm">{emp.full_name}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{emp.email}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                    <span className="text-xs text-gray-400">
                      <span className="text-gray-600">Manager:</span> {emp.manager_name || 'None'}
                    </span>
                    <span className="text-xs text-gray-400">
                      <span className="text-gray-600">Shifts:</span> {emp.shift_count}
                    </span>
                    <span className="text-xs text-gray-400">
                      <span className="text-gray-600">Total Hours:</span> {emp.total_hours}
                    </span>
                    {emp.terminated_at && (
                      <span className="text-xs text-gray-400">
                        <span className="text-gray-600">Last Shift:</span>{' '}
                        {new Date(emp.terminated_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => downloadRecord(emp)}
                    disabled={downloading === emp.id || emp.shift_count === 0}
                    className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors flex items-center gap-1.5"
                  >
                    {downloading === emp.id ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export
                      </>
                    )}
                  </button>
                  {canReactivate && (
                    <button
                      onClick={() => reactivateEmployee(emp)}
                      disabled={reactivating === emp.id}
                      className="bg-green-800 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors"
                    >
                      {reactivating === emp.id ? 'Reactivating...' : 'Reactivate'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-gray-600 text-xs mt-6 text-center leading-relaxed">
          Each export includes a Certification Letter, full Timecard Detail with GPS coordinates, and an Edit History audit trail.
          All exports are logged for compliance purposes.
        </p>
      </div>
    </div>
  )
}
