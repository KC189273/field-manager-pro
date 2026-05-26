'use client'

import { useState, useEffect, useCallback } from 'react'
import NavBar from '@/components/NavBar'
import { useRouter } from 'next/navigation'

interface Session {
  id: string
  fullName: string
  role: string
  email: string
}

interface DmRow {
  dm_id: string
  dm_name: string
  store_count: number
  store_visits: number
  checklists: number
  tasks_assigned: number
  schedules_published: number
  payroll_submitted: number
  accountability_docs: number
  supply_avg_response_hours: number | null
  facility_tickets: number
  open_facility_tickets: number
  merch_orders: number
  last_active_at: string | null
  inactive_24h: boolean
}

const RANGES = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
]

function dateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

function fmtHours(h: number | null): string {
  if (h === null) return '—'
  if (h < 24) return `${Math.round(h)}h`
  const days = Math.floor(h / 24)
  const rem = Math.round(h % 24)
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`
}

function fmtLastActive(ts: string | null): string {
  if (!ts) return 'Never'
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function totalActivity(dm: DmRow) {
  return dm.store_visits + dm.checklists + dm.tasks_assigned + dm.schedules_published + dm.payroll_submitted + dm.accountability_docs
}

function engagementLevel(dm: DmRow): 'high' | 'medium' | 'low' {
  const t = totalActivity(dm)
  if (t >= 10) return 'high'
  if (t >= 3) return 'medium'
  return 'low'
}

export default function DmEngagementPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [dms, setDms] = useState<DmRow[]>([])
  const [loading, setLoading] = useState(true)
  const [rangeDays, setRangeDays] = useState(30)
  const [sortBy, setSortBy] = useState<'activity' | 'name'>('activity')

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => {
      if (!d?.role) { router.push('/login'); return }
      if (!['ops_manager', 'sales_director', 'owner', 'developer'].includes(d.role)) {
        router.push('/dashboard'); return
      }
      setSession(d)
    })
  }, [router])

  const fetchData = useCallback(async (days: number) => {
    setLoading(true)
    const to = new Date()
    const from = new Date(Date.now() - days * 86400000)
    const res = await fetch(`/api/dm-engagement?from=${dateStr(from)}&to=${dateStr(to)}`)
    if (res.ok) {
      const data = await res.json()
      setDms(data.dms ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (session) fetchData(rangeDays)
  }, [session, rangeDays, fetchData])

  const sorted = [...dms].sort((a, b) =>
    sortBy === 'activity' ? totalActivity(b) - totalActivity(a) : a.dm_name.localeCompare(b.dm_name)
  )

  // Org-wide totals
  const totals = dms.reduce(
    (acc, dm) => ({
      visits: acc.visits + dm.store_visits,
      checklists: acc.checklists + dm.checklists,
      tasks: acc.tasks + dm.tasks_assigned,
      schedules: acc.schedules + dm.schedules_published,
      payroll: acc.payroll + dm.payroll_submitted,
      accountability: acc.accountability + dm.accountability_docs,
      facility: acc.facility + dm.facility_tickets,
      openFacility: acc.openFacility + dm.open_facility_tickets,
      merch: acc.merch + dm.merch_orders,
    }),
    { visits: 0, checklists: 0, tasks: 0, schedules: 0, payroll: 0, accountability: 0, facility: 0, openFacility: 0, merch: 0 }
  )
  const dmsWithAvg = dms.filter(d => d.supply_avg_response_hours !== null)
  const orgAvgResponse = dmsWithAvg.length
    ? dmsWithAvg.reduce((s, d) => s + d.supply_avg_response_hours!, 0) / dmsWithAvg.length
    : null

  if (!session) return null

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role as never} fullName={session.fullName} />

      <div className="px-4 pt-5 max-w-lg mx-auto space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-white">DM Engagement</h1>
          <p className="text-xs text-gray-500 mt-0.5">Activity across all district managers</p>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between gap-3">
          {/* Range pills */}
          <div className="flex gap-1.5">
            {RANGES.map(r => (
              <button
                key={r.days}
                onClick={() => setRangeDays(r.days)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                  rangeDays === r.days
                    ? 'bg-violet-600 border-violet-500 text-white'
                    : 'bg-gray-900 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {/* Sort */}
          <div className="flex gap-1.5">
            <button
              onClick={() => setSortBy('activity')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                sortBy === 'activity'
                  ? 'bg-gray-700 border-gray-600 text-white'
                  : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-white'
              }`}
            >
              Most Active
            </button>
            <button
              onClick={() => setSortBy('name')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                sortBy === 'name'
                  ? 'bg-gray-700 border-gray-600 text-white'
                  : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-white'
              }`}
            >
              A–Z
            </button>
          </div>
        </div>

        {/* Org totals */}
        {!loading && dms.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
              Org Total — Last {rangeDays} Days
            </p>
            <div className="grid grid-cols-5 gap-2 text-center">
              {[
                { label: 'Visits', value: totals.visits },
                { label: 'Checklists', value: totals.checklists },
                { label: 'Tasks', value: totals.tasks },
                { label: 'Schedules', value: totals.schedules },
                { label: 'Payroll', value: totals.payroll },
              ].map(m => (
                <div key={m.label}>
                  <p className="text-lg font-bold text-white">{m.value}</p>
                  <p className="text-[10px] text-gray-500 leading-tight">{m.label}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-800 pt-3 grid grid-cols-5 gap-2 text-center">
              {[
                { label: 'Accountability', value: totals.accountability },
                { label: 'Avg Supply\nResponse', value: fmtHours(orgAvgResponse) },
                { label: 'Facility\nTickets', value: totals.facility },
                { label: 'Open\nTickets', value: totals.openFacility },
                { label: 'Merch\nOrders', value: totals.merch },
              ].map(m => (
                <div key={m.label}>
                  <p className="text-lg font-bold text-white">{m.value}</p>
                  <p className="text-[10px] text-gray-500 leading-tight whitespace-pre-line">{m.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DM Cards */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden animate-pulse">
                <div className="p-4">
                  <div className="h-4 bg-gray-800 rounded w-1/2 mb-2" />
                  <div className="h-3 bg-gray-800 rounded w-1/3" />
                </div>
                <div className="grid grid-cols-5 border-t border-gray-800 gap-px bg-gray-800">
                  {[1,2,3,4,5].map(j => <div key={j} className="h-12 bg-gray-900" />)}
                </div>
                <div className="grid grid-cols-5 border-t border-gray-800 gap-px bg-gray-800">
                  {[1,2,3,4,5].map(j => <div key={j} className="h-10 bg-gray-900" />)}
                </div>
              </div>
            ))}
          </div>
        ) : dms.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm">No district managers found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map(dm => {
              const level = engagementLevel(dm)
              return (
                <div
                  key={dm.dm_id}
                  className={`bg-gray-900 rounded-2xl border overflow-hidden ${
                    level === 'high' ? 'border-green-800/60'
                    : level === 'medium' ? 'border-amber-800/60'
                    : 'border-gray-800'
                  }`}
                >
                  {/* Card header */}
                  <div className="px-4 pt-3.5 pb-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          level === 'high' ? 'bg-green-500'
                          : level === 'medium' ? 'bg-amber-500'
                          : 'bg-gray-600'
                        }`} />
                        <p className="text-sm font-semibold text-white truncate">{dm.dm_name}</p>
                      </div>
                      <span className="text-[10px] text-gray-500 flex-shrink-0 bg-gray-800 px-2 py-0.5 rounded-full">
                        {dm.store_count} store{dm.store_count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {dm.inactive_24h ? (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-red-400 bg-red-950/50 border border-red-900/60 px-2 py-0.5 rounded-full">
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                          </svg>
                          Inactive — last seen {fmtLastActive(dm.last_active_at)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-600">
                          Last active {fmtLastActive(dm.last_active_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Metrics grid — row 1 */}
                  <div className="grid grid-cols-5 border-t border-gray-800 divide-x divide-gray-800">
                    {[
                      { label: 'Store\nVisits', value: dm.store_visits, accent: dm.store_visits > 0 },
                      { label: 'Check-\nlists', value: dm.checklists, accent: dm.checklists > 0 },
                      { label: 'Tasks\nAssigned', value: dm.tasks_assigned, accent: dm.tasks_assigned > 0 },
                      { label: 'Sched.\nPublished', value: dm.schedules_published, accent: dm.schedules_published > 0 },
                      { label: 'Payroll\nSubmitted', value: dm.payroll_submitted, accent: dm.payroll_submitted > 0 },
                    ].map(m => (
                      <div key={m.label} className="flex flex-col items-center justify-center py-3 px-1 text-center gap-0.5">
                        <p className={`text-base font-bold leading-none ${m.accent ? 'text-white' : 'text-gray-600'}`}>
                          {m.value}
                        </p>
                        <p className="text-[9px] text-gray-600 leading-tight whitespace-pre-line">{m.label}</p>
                      </div>
                    ))}
                  </div>
                  {/* Metrics grid — row 2 */}
                  <div className="grid grid-cols-5 border-t border-gray-800/60 divide-x divide-gray-800/60">
                    {[
                      { label: 'Acct\nDocs', value: dm.accountability_docs, accent: dm.accountability_docs > 0 },
                      { label: 'Avg Supply\nResponse', value: fmtHours(dm.supply_avg_response_hours), accent: dm.supply_avg_response_hours !== null },
                      { label: 'Facility\nTickets', value: dm.facility_tickets, accent: dm.facility_tickets > 0 },
                      { label: 'Open\nTickets', value: dm.open_facility_tickets, accent: dm.open_facility_tickets > 0, warn: dm.open_facility_tickets > 0 },
                      { label: 'Merch\nOrders', value: dm.merch_orders, accent: dm.merch_orders > 0 },
                    ].map(m => (
                      <div key={m.label} className="flex flex-col items-center justify-center py-2.5 px-1 text-center gap-0.5">
                        <p className={`text-sm font-bold leading-none ${'warn' in m && m.warn ? 'text-amber-400' : m.accent ? 'text-violet-300' : 'text-gray-700'}`}>
                          {m.value}
                        </p>
                        <p className="text-[9px] text-gray-700 leading-tight whitespace-pre-line">{m.label}</p>
                      </div>
                    ))}
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
