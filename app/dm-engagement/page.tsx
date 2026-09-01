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

interface CoachingDm {
  dm_id: string; dm_name: string; avg_score: number | null; count: number
  grade: string | null; prev_grade: string | null; trend: string
}

interface CoachingDetail {
  id: string; visit_id: string; graded_at: string; store_address: string
  employee_coached: string | null; overall_grade: string; overall_score: number
  specificity_grade: string; specificity_feedback: string
  actionability_grade: string; actionability_feedback: string
  follow_up_grade: string; follow_up_feedback: string
  depth_grade: string; depth_feedback: string
  prior_reference_grade: string; prior_reference_feedback: string
  summary: string; improvement_tips: string
}

const gradeColor = (g: string | null) => {
  if (!g) return 'text-gray-500'
  if (g.startsWith('A')) return 'text-green-400'
  if (g.startsWith('B')) return 'text-blue-400'
  if (g.startsWith('C')) return 'text-amber-400'
  if (g.startsWith('D')) return 'text-orange-400'
  return 'text-red-400'
}

const gradeBg = (g: string | null) => {
  if (!g) return 'bg-gray-800'
  if (g.startsWith('A')) return 'bg-green-900/30 border-green-800/50'
  if (g.startsWith('B')) return 'bg-blue-900/30 border-blue-800/50'
  if (g.startsWith('C')) return 'bg-amber-900/30 border-amber-800/50'
  if (g.startsWith('D')) return 'bg-orange-900/30 border-orange-800/50'
  return 'bg-red-900/30 border-red-800/50'
}

const trendIcon = (t: string) => {
  if (t === 'improving') return '↑'
  if (t === 'declining') return '↓'
  if (t === 'consistent') return '→'
  return '•'
}

const trendColor = (t: string) => {
  if (t === 'improving') return 'text-green-400'
  if (t === 'declining') return 'text-red-400'
  return 'text-gray-500'
}

export default function DmEngagementPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [dms, setDms] = useState<DmRow[]>([])
  const [loading, setLoading] = useState(true)
  const [rangeDays, setRangeDays] = useState(30)
  const [sortBy, setSortBy] = useState<'activity' | 'name'>('activity')
  const [mainTab, setMainTab] = useState<'coaching' | 'metrics' | 'photos' | 'coaching_comp' | 'uniform'>('coaching')
  const [photoDate, setPhotoDate] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }))
  const [photoData, setPhotoData] = useState<{ date: string; totalShifts: number; withPhoto: number; withoutPhoto: number; photoRate: number; byDm: Record<string, { total: number; withPhoto: number }>; missing: Array<{ full_name: string; username: string; manager_name: string | null; store_address: string | null; clock_in_at: string }> } | null>(null)
  const [photoLoading, setPhotoLoading] = useState(false)

  // Uniform compliance state
  const [uniformMode, setUniformMode] = useState<'range' | 'date'>('range')
  const [uniformDays, setUniformDays] = useState('7')
  const [uniformDate, setUniformDate] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }))
  const [uniformData, setUniformData] = useState<{ stats: { total: number; passed: number; failed: number; unclear: number; skipped: number; monthly_cost: number }; failures: Array<{ user_name: string; details: string; shirt_ok: boolean | null; nametag_ok: boolean | null; created_at: string; photo_url?: string | null }>; offenders: Array<{ user_name: string; fail_count: number }> } | null>(null)
  const [uniformLoading, setUniformLoading] = useState(false)

  // Coaching compliance state
  const [coachCompRange, setCoachCompRange] = useState('7')
  const [coachCompData, setCoachCompData] = useState<{ dmStats: Array<{ dm_id: string; dm_name: string; total_visits: number; visits_with_coaching: number; visits_without_coaching: number; compliance_rate: number }>; totals: { totalVisits: number; withCoaching: number; withoutCoaching: number; overallRate: number }; todayMissing: Array<{ dm_name: string; store_address: string; submitted_at: string }> } | null>(null)
  const [coachCompLoading, setCoachCompLoading] = useState(false)

  // Coaching state
  const [coachingDms, setCoachingDms] = useState<CoachingDm[]>([])
  const [coachingLoading, setCoachingLoading] = useState(true)
  const [selectedDmId, setSelectedDmId] = useState<string | null>(null)
  const [selectedDmName, setSelectedDmName] = useState('')
  const [coachingDetails, setCoachingDetails] = useState<CoachingDetail[]>([])
  const [coachingMonthlyAvg, setCoachingMonthlyAvg] = useState<Array<{ month: string; avg_score: number; grade: string; count: number }>>([])
  const [coachingTrend, setCoachingTrend] = useState('new')
  const [detailLoading, setDetailLoading] = useState(false)
  const [expandedGrade, setExpandedGrade] = useState<string | null>(null)
  const [availableMonths, setAvailableMonths] = useState<string[]>([])
  const [selectedMonth, setSelectedMonth] = useState('')

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => {
      if (!d?.role) { router.push('/login'); return }
      if (!['ops_field_leader', 'ops_manager', 'sales_director', 'owner', 'developer'].includes(d.role)) {
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

  // Load coaching rollup
  useEffect(() => {
    if (!session) return
    setCoachingLoading(true)
    fetch('/api/coaching-grades').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.dmRollup) setCoachingDms(d.dmRollup)
      if (d?.availableMonths) setAvailableMonths(d.availableMonths)
      if (d?.currentMonth && !selectedMonth) setSelectedMonth(d.currentMonth)
      setCoachingLoading(false)
    }).catch(() => setCoachingLoading(false))
  }, [session])

  async function loadUniformCompliance(d?: string, date?: string) {
    setUniformLoading(true)
    try {
      const params = date ? `date=${date}` : `days=${d || uniformDays}`
      const res = await fetch(`/api/reports/uniform-compliance?${params}`)
      if (res.ok) setUniformData(await res.json())
    } catch { /* ignore */ }
    finally { setUniformLoading(false) }
  }

  async function loadCoachingCompliance(r?: string) {
    setCoachCompLoading(true)
    try {
      const res = await fetch(`/api/reports/coaching-compliance?range=${r || coachCompRange}`)
      if (res.ok) setCoachCompData(await res.json())
    } catch { /* ignore */ }
    finally { setCoachCompLoading(false) }
  }

  async function loadPhotoCompliance(d?: string) {
    setPhotoLoading(true)
    try {
      const res = await fetch(`/api/reports/photo-compliance?date=${d || photoDate}`)
      if (res.ok) setPhotoData(await res.json())
    } catch { /* ignore */ }
    finally { setPhotoLoading(false) }
  }

  function openDmCoaching(dmId: string, dmName: string, month?: string) {
    setSelectedDmId(dmId)
    setSelectedDmName(dmName)
    setDetailLoading(true)
    const m = month || selectedMonth
    fetch(`/api/coaching-grades?dmId=${dmId}${m ? `&month=${m}` : ''}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d) {
        setCoachingDetails(d.grades ?? [])
        setCoachingMonthlyAvg(d.monthlyAvg ?? [])
        setCoachingTrend(d.trend ?? 'new')
      }
      setDetailLoading(false)
    }).catch(() => setDetailLoading(false))
  }

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
          <p className="text-xs text-gray-500 mt-0.5">Coaching performance and activity metrics</p>
        </div>

        {/* Main Tab Switcher */}
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
          <button
            onClick={() => { setMainTab('coaching'); setSelectedDmId(null) }}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${mainTab === 'coaching' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Coaching Performance
          </button>
          <button
            onClick={() => setMainTab('metrics')}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${mainTab === 'metrics' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Activity Metrics
          </button>
          <button
            onClick={() => { setMainTab('photos'); if (!photoData) loadPhotoCompliance() }}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${mainTab === 'photos' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Photos
          </button>
          <button
            onClick={() => { setMainTab('coaching_comp'); if (!coachCompData) loadCoachingCompliance() }}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${mainTab === 'coaching_comp' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Coaching
          </button>
          <button
            onClick={() => { setMainTab('uniform'); if (!uniformData) loadUniformCompliance() }}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${mainTab === 'uniform' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Uniform
          </button>
        </div>

        {/* ── Coaching Performance Tab ── */}
        {mainTab === 'coaching' && !selectedDmId && (
          <div className="space-y-3">
            {/* Month selector */}
            {availableMonths.length > 0 && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                  {new Date(selectedMonth + '-01T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </p>
                <select
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  className="bg-gray-900 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500"
                >
                  {availableMonths.map(m => (
                    <option key={m} value={m}>
                      {new Date(m + '-01T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {coachingLoading ? (
              <p className="text-gray-500 text-sm text-center py-10">Loading coaching data...</p>
            ) : coachingDms.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500 text-sm">No coaching grades yet.</p>
                <p className="text-gray-600 text-xs mt-1">Grades appear after DMs submit Quick Visit w/ Coaching reports.</p>
              </div>
            ) : (
              coachingDms.map(dm => (
                <button
                  key={dm.dm_id}
                  onClick={() => openDmCoaching(dm.dm_id, dm.dm_name)}
                  className="w-full bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4 text-left hover:border-violet-700/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-semibold text-sm">{dm.dm_name}</p>
                      <p className="text-gray-500 text-xs mt-0.5">
                        {dm.count} coaching{dm.count !== 1 ? 's' : ''} this month
                        {dm.prev_grade && ` · Last month: ${dm.prev_grade}`}
                      </p>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      {dm.grade ? (
                        <>
                          <span className={`text-2xl font-bold ${gradeColor(dm.grade)}`}>{dm.grade}</span>
                          <span className={`text-sm ${trendColor(dm.trend)}`}>{trendIcon(dm.trend)}</span>
                        </>
                      ) : (
                        <span className="text-gray-600 text-sm">No grades</span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {/* ── DM Coaching Detail View ── */}
        {mainTab === 'coaching' && selectedDmId && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <button onClick={() => setSelectedDmId(null)} className="text-violet-400 text-sm font-semibold hover:text-violet-300 transition-colors">
                ← Back to all DMs
              </button>
              {availableMonths.length > 0 && (
                <select
                  value={selectedMonth}
                  onChange={e => { setSelectedMonth(e.target.value); openDmCoaching(selectedDmId, selectedDmName, e.target.value) }}
                  className="bg-gray-900 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500"
                >
                  {availableMonths.map(m => (
                    <option key={m} value={m}>
                      {new Date(m + '-01T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">{selectedDmName}</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {coachingTrend !== 'new' ? `Trend: ${coachingTrend}` : 'First month'}
                  {coachingMonthlyAvg.length > 0 && ` · ${coachingMonthlyAvg[0].count} coaching${coachingMonthlyAvg[0].count !== 1 ? 's' : ''} this month`}
                </p>
              </div>
              {coachingMonthlyAvg.length > 0 && (
                <div className="text-right">
                  <p className={`text-3xl font-bold ${gradeColor(coachingMonthlyAvg[0].grade)}`}>{coachingMonthlyAvg[0].grade}</p>
                  <p className="text-xs text-gray-500">Monthly Avg</p>
                </div>
              )}
            </div>

            {/* Monthly trend cards */}
            {coachingMonthlyAvg.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {coachingMonthlyAvg.map(m => (
                  <div key={m.month} className={`flex-shrink-0 px-3 py-2 rounded-xl border ${gradeBg(m.grade)} text-center min-w-[70px]`}>
                    <p className={`text-lg font-bold ${gradeColor(m.grade)}`}>{m.grade}</p>
                    <p className="text-[10px] text-gray-500">{m.month}</p>
                    <p className="text-[10px] text-gray-600">{m.count} visit{m.count !== 1 ? 's' : ''}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Individual coaching grades */}
            {detailLoading ? (
              <p className="text-gray-500 text-sm text-center py-10">Loading...</p>
            ) : coachingDetails.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-10">No coaching grades for this period.</p>
            ) : (
              <div className="space-y-3">
                {coachingDetails.map(g => {
                  const expanded = expandedGrade === g.id
                  const tips = (() => { try { return JSON.parse(g.improvement_tips) } catch { return [] } })() as string[]
                  return (
                    <div key={g.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                      <button
                        onClick={() => setExpandedGrade(expanded ? null : g.id)}
                        className="w-full px-5 py-4 text-left"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-white font-semibold text-sm">{g.store_address}</p>
                            <p className="text-gray-500 text-xs mt-0.5">
                              {g.employee_coached && `${g.employee_coached} · `}
                              {new Date(g.graded_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' })}
                            </p>
                          </div>
                          <span className={`text-2xl font-bold ${gradeColor(g.overall_grade)}`}>{g.overall_grade}</span>
                        </div>
                      </button>

                      {expanded && (
                        <div className="border-t border-gray-800 px-5 py-4 space-y-3">
                          <p className="text-gray-300 text-sm leading-relaxed">{g.summary}</p>

                          {[
                            { label: 'Specificity', weight: '25%', grade: g.specificity_grade, feedback: g.specificity_feedback },
                            { label: 'Actionability', weight: '25%', grade: g.actionability_grade, feedback: g.actionability_feedback },
                            { label: 'Follow-Up', weight: '20%', grade: g.follow_up_grade, feedback: g.follow_up_feedback },
                            { label: 'Depth', weight: '20%', grade: g.depth_grade, feedback: g.depth_feedback },
                            { label: 'Prior Reference', weight: '10%', grade: g.prior_reference_grade, feedback: g.prior_reference_feedback },
                          ].map(cat => (
                            <div key={cat.label} className="flex items-start gap-3">
                              <span className={`text-sm font-bold w-8 text-center flex-shrink-0 ${gradeColor(cat.grade)}`}>{cat.grade}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-gray-400">{cat.label} <span className="text-gray-600">({cat.weight})</span></p>
                                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{cat.feedback}</p>
                              </div>
                            </div>
                          ))}

                          {tips.length > 0 && (
                            <div className="pt-2 border-t border-gray-800">
                              <p className="text-xs font-bold text-violet-400 uppercase tracking-wide mb-2">How to Improve</p>
                              {tips.map((tip, i) => (
                                <p key={i} className="text-xs text-gray-400 leading-relaxed mb-1">• {tip}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Metrics Tab (existing content) ── */}
        {mainTab === 'metrics' && (
        <>
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
        </>
        )}
        {/* ── Uniform Compliance Tab ── */}
        {mainTab === 'uniform' && (
          <div className="space-y-4">
            <div className="mb-4">
              <div className="flex gap-2 mb-2">
                <button onClick={() => setUniformMode('range')}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${uniformMode === 'range' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400'}`}>Range</button>
                <button onClick={() => setUniformMode('date')}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${uniformMode === 'date' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400'}`}>Specific Date</button>
              </div>
              <div className="flex items-end gap-2">
                {uniformMode === 'range' ? (
                  <div className="flex-1">
                    <select value={uniformDays} onChange={e => setUniformDays(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500">
                      <option value="7">Last 7 days</option>
                      <option value="14">Last 14 days</option>
                      <option value="30">Last 30 days</option>
                    </select>
                  </div>
                ) : (
                  <div className="flex-1">
                    <input type="date" value={uniformDate} onChange={e => setUniformDate(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500" />
                  </div>
                )}
                <button onClick={() => uniformMode === 'date' ? loadUniformCompliance(undefined, uniformDate) : loadUniformCompliance(uniformDays)} disabled={uniformLoading}
                  className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
                  {uniformLoading ? '...' : 'Load'}
                </button>
              </div>
            </div>

            {uniformLoading ? (
              <p className="text-center text-gray-500 py-10 text-sm">Loading...</p>
            ) : !uniformData ? (
              <p className="text-center text-gray-600 py-10 text-sm">Select a range and click Load</p>
            ) : (
              <>
                {/* Summary */}
                <div className="grid grid-cols-4 gap-2">
                  <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                    <p className="text-lg font-bold text-white">{uniformData.stats.total}</p>
                    <p className="text-[10px] text-gray-500">Checked</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                    <p className="text-lg font-bold text-green-400">{uniformData.stats.passed}</p>
                    <p className="text-[10px] text-gray-500">Passed</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                    <p className={`text-lg font-bold ${uniformData.stats.failed > 0 ? 'text-red-400' : 'text-white'}`}>{uniformData.stats.failed}</p>
                    <p className="text-[10px] text-gray-500">Failed</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                    <p className="text-lg font-bold text-gray-400">{uniformData.stats.skipped}</p>
                    <p className="text-[10px] text-gray-500">Skipped</p>
                  </div>
                </div>

                {/* Monthly cost */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-400">Monthly AI Cost</p>
                    <p className="text-sm font-bold text-white">${uniformData.stats.monthly_cost.toFixed(2)} / $20.00</p>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2">
                    <div className={`h-2 rounded-full ${uniformData.stats.monthly_cost >= 20 ? 'bg-red-500' : uniformData.stats.monthly_cost >= 15 ? 'bg-amber-500' : 'bg-green-500'}`}
                      style={{ width: `${Math.min(100, (uniformData.stats.monthly_cost / 20) * 100)}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-600 mt-1">
                    {uniformData.stats.monthly_cost >= 20 ? 'Cap reached — checking paused' : uniformData.stats.monthly_cost >= 15 ? 'Targeted mode — checking repeat offenders only' : 'Full coverage — checking all photos'}
                  </p>
                </div>

                {/* Repeat offenders */}
                {uniformData.offenders.length > 0 && (
                  <div>
                    <p className="text-xs text-red-400 font-semibold uppercase tracking-wide mb-2">Repeat Offenders (30 days)</p>
                    <div className="space-y-1">
                      {uniformData.offenders.map((o, i) => (
                        <div key={i} className="bg-red-900/10 border border-red-800/30 rounded-xl px-3 py-2 flex items-center justify-between">
                          <p className="text-sm text-white">{o.user_name}</p>
                          <span className="text-xs text-red-400 font-bold">{o.fail_count} violations</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent failures */}
                {uniformData.failures.length > 0 && (
                  <div>
                    <p className="text-xs text-amber-400 font-semibold uppercase tracking-wide mb-2">Recent Failures ({uniformData.failures.length})</p>
                    <div className="space-y-2">
                      {uniformData.failures.map((f: { user_name: string; details: string; shirt_ok: boolean | null; nametag_ok: boolean | null; created_at: string; photo_url?: string | null }, i: number) => (
                        <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5">
                          <div className="flex items-start gap-3">
                            {f.photo_url && (
                              <button onClick={() => window.open(f.photo_url!, '_blank')} className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-gray-700 hover:border-red-500 transition-colors">
                                <img src={f.photo_url} alt={f.user_name} className="w-full h-full object-cover" />
                              </button>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-sm font-medium text-white">{f.user_name}</p>
                                <p className="text-xs text-gray-600">{new Date(f.created_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' })}</p>
                              </div>
                              <div className="flex items-center gap-3 text-xs">
                                <span className={f.shirt_ok === false ? 'text-red-400' : f.shirt_ok === true ? 'text-green-400' : 'text-gray-500'}>
                                  Shirt: {f.shirt_ok === false ? 'Fail' : f.shirt_ok === true ? 'Pass' : '?'}
                                </span>
                                <span className={f.nametag_ok === false ? 'text-red-400' : f.nametag_ok === true ? 'text-green-400' : 'text-gray-500'}>
                                  Tag: {f.nametag_ok === false ? 'Fail' : f.nametag_ok === true ? 'Pass' : '?'}
                                </span>
                              </div>
                              {f.details && <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{f.details}</p>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {uniformData.stats.total === 0 && (
                  <p className="text-center text-gray-600 py-6 text-sm">No uniform checks yet — they start with the next clock-in photo</p>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Coaching Compliance Tab ── */}
        {mainTab === 'coaching_comp' && (
          <div className="space-y-4">
            <div className="flex items-end gap-2 mb-4">
              <div className="flex-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wide mb-1 block">Range</label>
                <select value={coachCompRange} onChange={e => setCoachCompRange(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500">
                  <option value="7">Last 7 days</option>
                  <option value="14">Last 14 days</option>
                  <option value="30">Last 30 days</option>
                </select>
              </div>
              <button onClick={() => loadCoachingCompliance(coachCompRange)} disabled={coachCompLoading}
                className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
                {coachCompLoading ? '...' : 'Load'}
              </button>
            </div>

            {coachCompLoading ? (
              <p className="text-center text-gray-500 py-10 text-sm">Loading...</p>
            ) : !coachCompData ? (
              <p className="text-center text-gray-600 py-10 text-sm">Select a range and click Load</p>
            ) : (
              <>
                {/* Summary */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                    <p className="text-lg font-bold text-white">{coachCompData.totals.totalVisits}</p>
                    <p className="text-[10px] text-gray-500">Total Visits</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                    <p className="text-lg font-bold text-green-400">{coachCompData.totals.withCoaching}</p>
                    <p className="text-[10px] text-gray-500">With Coaching</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                    <p className={`text-lg font-bold ${coachCompData.totals.withoutCoaching > 0 ? 'text-red-400' : 'text-white'}`}>{coachCompData.totals.withoutCoaching}</p>
                    <p className="text-[10px] text-gray-500">Without Coaching</p>
                  </div>
                </div>

                {/* Rate bar */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-400">Coaching Compliance Rate</p>
                    <p className={`text-sm font-bold ${coachCompData.totals.overallRate >= 90 ? 'text-green-400' : coachCompData.totals.overallRate >= 70 ? 'text-amber-400' : 'text-red-400'}`}>{coachCompData.totals.overallRate}%</p>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2">
                    <div className={`h-2 rounded-full ${coachCompData.totals.overallRate >= 90 ? 'bg-green-500' : coachCompData.totals.overallRate >= 70 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${coachCompData.totals.overallRate}%` }} />
                  </div>
                </div>

                {/* Per-DM breakdown */}
                <div>
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">By DM</p>
                  <div className="space-y-2">
                    {coachCompData.dmStats.map(dm => (
                      <div key={dm.dm_id} className={`bg-gray-900 border rounded-xl px-4 py-2.5 flex items-center justify-between ${dm.compliance_rate < 70 ? 'border-red-800/40' : dm.compliance_rate < 100 ? 'border-amber-800/30' : 'border-gray-800'}`}>
                        <div>
                          <p className="text-sm font-medium text-white">{dm.dm_name}</p>
                          <p className="text-xs text-gray-500">{dm.visits_with_coaching}/{dm.total_visits} visits with coaching</p>
                        </div>
                        <span className={`text-sm font-bold ${dm.compliance_rate >= 90 ? 'text-green-400' : dm.compliance_rate >= 70 ? 'text-amber-400' : 'text-red-400'}`}>{dm.compliance_rate}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Today's missing */}
                {coachCompData.todayMissing.length > 0 && (
                  <div>
                    <p className="text-xs text-red-400 font-semibold uppercase tracking-wide mb-2">Today&apos;s Visits Without Coaching ({coachCompData.todayMissing.length})</p>
                    <div className="space-y-1">
                      {coachCompData.todayMissing.map((m, i) => (
                        <div key={i} className="bg-red-900/10 border border-red-800/30 rounded-xl px-3 py-2 flex items-center justify-between">
                          <div>
                            <p className="text-sm text-white">{m.dm_name}</p>
                            <p className="text-xs text-gray-500">{m.store_address}</p>
                          </div>
                          <p className="text-xs text-gray-600">{new Date(m.submitted_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Photo Compliance Tab ── */}
        {mainTab === 'photos' && (
          <div className="space-y-4">
            <div className="flex items-end gap-2 mb-4">
              <div className="flex-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wide mb-1 block">Date</label>
                <input type="date" value={photoDate} onChange={e => setPhotoDate(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500" />
              </div>
              <button onClick={() => loadPhotoCompliance(photoDate)} disabled={photoLoading}
                className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
                {photoLoading ? '...' : 'Load'}
              </button>
            </div>

            {photoLoading ? (
              <p className="text-center text-gray-500 py-10 text-sm">Loading...</p>
            ) : !photoData ? (
              <p className="text-center text-gray-600 py-10 text-sm">Select a date and click Load</p>
            ) : (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                    <p className="text-lg font-bold text-white">{photoData.totalShifts}</p>
                    <p className="text-[10px] text-gray-500">Total Clock-ins</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                    <p className="text-lg font-bold text-green-400">{photoData.withPhoto}</p>
                    <p className="text-[10px] text-gray-500">With Photo</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                    <p className={`text-lg font-bold ${photoData.withoutPhoto > 0 ? 'text-red-400' : 'text-white'}`}>{photoData.withoutPhoto}</p>
                    <p className="text-[10px] text-gray-500">Missing Photo</p>
                  </div>
                </div>

                {/* Compliance rate bar */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-400">Compliance Rate</p>
                    <p className={`text-sm font-bold ${photoData.photoRate >= 80 ? 'text-green-400' : photoData.photoRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{photoData.photoRate}%</p>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2">
                    <div className={`h-2 rounded-full ${photoData.photoRate >= 80 ? 'bg-green-500' : photoData.photoRate >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${photoData.photoRate}%` }} />
                  </div>
                </div>

                {/* By DM breakdown */}
                <div>
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">By DM</p>
                  <div className="space-y-2">
                    {Object.entries(photoData.byDm).sort((a, b) => {
                      const rateA = a[1].total > 0 ? a[1].withPhoto / a[1].total : 0
                      const rateB = b[1].total > 0 ? b[1].withPhoto / b[1].total : 0
                      return rateA - rateB
                    }).map(([dm, data]) => {
                      const rate = data.total > 0 ? Math.round((data.withPhoto / data.total) * 100) : 0
                      return (
                        <div key={dm} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-white">{dm}</p>
                            <p className="text-xs text-gray-500">{data.withPhoto}/{data.total} with photo</p>
                          </div>
                          <span className={`text-sm font-bold ${rate >= 80 ? 'text-green-400' : rate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{rate}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Missing photos list */}
                {photoData.missing.length > 0 && (
                  <div>
                    <p className="text-xs text-red-400 font-semibold uppercase tracking-wide mb-2">Missing Photos ({photoData.missing.length})</p>
                    <div className="space-y-1">
                      {photoData.missing.map((m, i) => (
                        <div key={i} className="bg-red-900/10 border border-red-800/30 rounded-xl px-3 py-2 flex items-center justify-between">
                          <div>
                            <p className="text-sm text-white">{m.full_name}</p>
                            <p className="text-xs text-gray-500">{m.store_address || 'No store'} · {m.manager_name || 'Unassigned'}</p>
                          </div>
                          <p className="text-xs text-gray-600">{new Date(m.clock_in_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
