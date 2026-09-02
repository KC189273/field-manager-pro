'use client'

import { useState, useEffect } from 'react'
import NavBar from '@/components/NavBar'

type Role = 'employee' | 'manager' | 'ops_field_leader' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
interface Session { id: string; fullName: string; role: Role }

interface ClockedInEmp { name: string; clock_in_at: string; hours: number }
interface ScheduledEmp { name: string; start_time: string; end_time: string | null; clocked_in: boolean }
interface Store { store_id: string; address: string; closed_today: boolean; clocked_in: ClockedInEmp[]; scheduled: ScheduledEmp[] }
interface DmData { dm_id: string; dm_name: string; stores: Store[]; total_clocked_in: number; total_stores: number; stores_covered: number }

const CST = 'America/Chicago'

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: CST, hour: 'numeric', minute: '2-digit', hour12: true })
}
function fmtScheduleTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

export default function CoveragePage() {
  const [session, setSession] = useState<Session | null>(null)
  const [dms, setDms] = useState<DmData[]>([])
  const [totalClockedIn, setTotalClockedIn] = useState(0)
  const [totalScheduled, setTotalScheduled] = useState(0)
  const [asOf, setAsOf] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedDm, setExpandedDm] = useState<string | null>(null)
  const [expandedStore, setExpandedStore] = useState<string | null>(null)

  function loadData() {
    setLoading(true)
    fetch('/api/coverage').then(r => r.ok ? r.json() : null).then(d => {
      if (d) {
        setDms(d.dms || [])
        setTotalClockedIn(d.totalClockedIn || 0)
        setTotalScheduled(d.totalScheduled || 0)
        setAsOf(d.asOf || '')
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(setSession)
    loadData()
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-bold text-white">Live Coverage</h1>
          <button onClick={loadData} disabled={loading}
            className="text-xs text-violet-400 hover:text-violet-300 font-semibold disabled:opacity-50">
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">{asOf ? `As of ${asOf} CST` : 'Loading...'}</p>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
            <p className="text-lg font-bold text-green-400">{totalClockedIn}</p>
            <p className="text-[10px] text-gray-500">Clocked In</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
            <p className="text-lg font-bold text-amber-400">{totalScheduled}</p>
            <p className="text-[10px] text-gray-500">Scheduled (not in)</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
            <p className="text-lg font-bold text-white">{dms.reduce((s, d) => s + d.stores_covered, 0)}/{dms.reduce((s, d) => s + d.total_stores, 0)}</p>
            <p className="text-[10px] text-gray-500">Stores Covered</p>
          </div>
        </div>

        {loading ? (
          <p className="text-center text-gray-500 py-10">Loading coverage data...</p>
        ) : (
          <div className="space-y-3">
            {dms.map(dm => {
              const isExpanded = expandedDm === dm.dm_id
              const coverageColor = dm.total_stores === 0 ? 'text-gray-500' :
                dm.stores_covered === dm.total_stores ? 'text-green-400' :
                dm.stores_covered >= dm.total_stores * 0.5 ? 'text-amber-400' : 'text-red-400'

              return (
                <div key={dm.dm_id}>
                  <button
                    onClick={() => { setExpandedDm(isExpanded ? null : dm.dm_id); setExpandedStore(null) }}
                    className={`w-full bg-gray-900 border rounded-xl px-4 py-3 text-left transition-colors hover:border-violet-500/50 ${isExpanded ? 'border-violet-500/50 rounded-b-none' : 'border-gray-800'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-white">{dm.dm_name}</p>
                        <p className="text-xs text-gray-500">{dm.total_clocked_in} clocked in · {dm.stores_covered}/{dm.total_stores} stores covered</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${coverageColor}`}>
                          {dm.total_stores > 0 ? Math.round((dm.stores_covered / dm.total_stores) * 100) : 0}%
                        </span>
                        <svg className={`w-4 h-4 text-gray-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="bg-gray-900 border border-t-0 border-violet-500/50 rounded-b-xl px-3 pb-3 space-y-2">
                      {dm.stores.map(store => {
                        const storeExpanded = expandedStore === store.store_id
                        const isCovered = store.clocked_in.length > 0
                        const scheduledNotIn = store.scheduled.filter(s => !s.clocked_in)

                        return (
                          <div key={store.store_id}>
                            <button
                              onClick={() => setExpandedStore(storeExpanded ? null : store.store_id)}
                              className={`w-full px-3 py-2.5 rounded-xl text-left transition-colors ${
                                store.closed_today ? 'bg-gray-800/50 opacity-60' :
                                isCovered ? 'bg-green-900/10 border border-green-800/30' :
                                'bg-red-900/10 border border-red-800/30'
                              } ${storeExpanded ? 'rounded-b-none' : ''}`}
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm text-white">{store.address}</p>
                                  {store.closed_today ? (
                                    <p className="text-xs text-red-400">Closed Today</p>
                                  ) : (
                                    <p className="text-xs text-gray-500">
                                      {store.clocked_in.length} working{scheduledNotIn.length > 0 ? ` · ${scheduledNotIn.length} scheduled (not in)` : ''}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {!store.closed_today && (
                                    <span className={`text-sm font-bold ${isCovered ? 'text-green-400' : 'text-red-400'}`}>
                                      {store.clocked_in.length}
                                    </span>
                                  )}
                                  <svg className={`w-3.5 h-3.5 text-gray-600 transition-transform ${storeExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                  </svg>
                                </div>
                              </div>
                            </button>

                            {storeExpanded && !store.closed_today && (
                              <div className="bg-gray-800/50 rounded-b-xl px-3 pb-2 pt-1 space-y-1">
                                {store.clocked_in.length > 0 && (
                                  <>
                                    <p className="text-[10px] text-green-400 uppercase tracking-wide font-semibold pt-1">Clocked In</p>
                                    {store.clocked_in.map((emp, i) => (
                                      <div key={i} className="flex items-center justify-between py-1">
                                        <p className="text-sm text-white">{emp.name}</p>
                                        <div className="text-right">
                                          <p className="text-xs text-gray-400">{fmtTime(emp.clock_in_at)}</p>
                                          <p className="text-[10px] text-gray-600">{emp.hours}h so far</p>
                                        </div>
                                      </div>
                                    ))}
                                  </>
                                )}

                                {scheduledNotIn.length > 0 && (
                                  <>
                                    <p className="text-[10px] text-amber-400 uppercase tracking-wide font-semibold pt-1">Scheduled — Not Clocked In</p>
                                    {scheduledNotIn.map((emp, i) => (
                                      <div key={i} className="flex items-center justify-between py-1">
                                        <p className="text-sm text-amber-300">{emp.name}</p>
                                        <p className="text-xs text-gray-500">{fmtScheduleTime(emp.start_time)}{emp.end_time ? ` - ${fmtScheduleTime(emp.end_time)}` : ''}</p>
                                      </div>
                                    ))}
                                  </>
                                )}

                                {store.clocked_in.length === 0 && scheduledNotIn.length === 0 && (
                                  <p className="text-xs text-gray-600 py-2 text-center">No one working or scheduled</p>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
