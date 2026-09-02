'use client'

import { useState, useEffect } from 'react'

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

export default function DashboardCoverage() {
  const [dms, setDms] = useState<DmData[]>([])
  const [totalClockedIn, setTotalClockedIn] = useState(0)
  const [asOf, setAsOf] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedDm, setExpandedDm] = useState<string | null>(null)
  const [expandedStore, setExpandedStore] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/coverage').then(r => r.ok ? r.json() : null).then(d => {
      if (d) { setDms(d.dms || []); setTotalClockedIn(d.totalClockedIn || 0); setAsOf(d.asOf || '') }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4"><p className="text-sm text-gray-500">Loading coverage...</p></div>

  const totalStores = dms.reduce((s, d) => s + d.total_stores, 0)
  const storesCovered = dms.reduce((s, d) => s + d.stores_covered, 0)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-800/60">
        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Live Coverage</p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">{asOf}</span>
          <a href="/coverage" className="text-xs text-violet-500">Full View →</a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 py-3">
        <div className="text-center">
          <p className="text-lg font-bold text-green-400">{totalClockedIn}</p>
          <p className="text-[10px] text-gray-500">Clocked In</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-white">{storesCovered}/{totalStores}</p>
          <p className="text-[10px] text-gray-500">Stores Covered</p>
        </div>
      </div>

      <div className="px-3 pb-3 space-y-1.5">
        {dms.map(dm => {
          const isExpanded = expandedDm === dm.dm_id
          const coverPct = dm.total_stores > 0 ? Math.round((dm.stores_covered / dm.total_stores) * 100) : 0
          const color = coverPct === 100 ? 'text-green-400' : coverPct >= 50 ? 'text-amber-400' : 'text-red-400'

          return (
            <div key={dm.dm_id}>
              <button
                onClick={() => { setExpandedDm(isExpanded ? null : dm.dm_id); setExpandedStore(null) }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${isExpanded ? 'bg-gray-800' : 'hover:bg-gray-800/50'}`}
              >
                <div>
                  <p className="text-sm font-medium text-white">{dm.dm_name}</p>
                  <p className="text-[11px] text-gray-500">{dm.total_clocked_in} in · {dm.stores_covered}/{dm.total_stores} stores</p>
                </div>
                <span className={`text-sm font-bold ${color}`}>{coverPct}%</span>
              </button>

              {isExpanded && (
                <div className="pl-3 pr-1 pb-1 space-y-1">
                  {dm.stores.map(store => {
                    const storeExp = expandedStore === store.store_id
                    const isCovered = store.clocked_in.length > 0
                    const scheduledNotIn = store.scheduled.filter(s => !s.clocked_in)

                    return (
                      <div key={store.store_id}>
                        <button
                          onClick={() => setExpandedStore(storeExp ? null : store.store_id)}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs ${
                            store.closed_today ? 'text-gray-600' : isCovered ? 'text-green-400' : 'text-red-400'
                          } hover:bg-gray-800/50`}
                        >
                          <span className="truncate">{store.address}</span>
                          <span className="shrink-0 ml-2">{store.closed_today ? 'Closed' : store.clocked_in.length}</span>
                        </button>

                        {storeExp && !store.closed_today && (
                          <div className="pl-4 pr-2 pb-1 space-y-0.5">
                            {store.clocked_in.map((emp, i) => (
                              <div key={i} className="flex items-center justify-between text-xs py-0.5">
                                <span className="text-white">{emp.name}</span>
                                <span className="text-gray-500">{fmtTime(emp.clock_in_at)} · {emp.hours}h</span>
                              </div>
                            ))}
                            {scheduledNotIn.map((emp, i) => (
                              <div key={`s${i}`} className="flex items-center justify-between text-xs py-0.5">
                                <span className="text-amber-400">{emp.name}</span>
                                <span className="text-gray-600">{fmtScheduleTime(emp.start_time)} (not in)</span>
                              </div>
                            ))}
                            {store.clocked_in.length === 0 && scheduledNotIn.length === 0 && (
                              <p className="text-[11px] text-gray-600 py-1">No one working or scheduled</p>
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
    </div>
  )
}
