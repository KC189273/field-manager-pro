'use client'

import { useState, useEffect } from 'react'
import NavBar from '@/components/NavBar'
import { downloadBlob } from '@/lib/download'

type Role = 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'

interface Session {
  id: string
  fullName: string
  role: Role
}

interface DmApproval {
  dm_id: string
  dm_name: string
  approved_at: string
}

interface SrApproval {
  dm_id: string
  dm_name: string
  downloaded_at: string | null
  approved_at: string | null
  sr_user_id: string | null
  sr_name: string | null
}

interface DmTimeApproval {
  dm_id: string
  approved_by_name: string
  approved_at: string
}

interface Period {
  id: string
  period_start: string
  period_end: string
  status: string
  final_submitted_at: string | null
  final_submitted_by: string | null
  final_submitter_name: string | null
  dmApprovals: DmApproval[]
  srApprovals: SrApproval[]
  dmTimeApprovals: DmTimeApproval[]
  totalDMs: number
}

interface EmployeeHours {
  avatar_url?: string | null
  user_id: string
  full_name: string
  regular_hours: number
  ot_hours: number
  total_hours: number
}

interface WeeklyHours {
  start: string
  end: string
  isCurrent: boolean
  employees: EmployeeHours[]
}

function fmtPeriod(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const e = new Date(end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${s} – ${e}`
}

function fmtWeek(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const e = new Date(end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${s} – ${e}`
}

function fmtDatetime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const canSrApprove = (role: Role) =>
  ['sales_director', 'ops_manager', 'developer', 'owner'].includes(role)

const canDownload = (role: Role) =>
  ['sales_director', 'ops_manager', 'owner', 'developer'].includes(role)

export default function PayrollPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [periods, setPeriods] = useState<Period[]>([])
  const [myHours, setMyHours] = useState<EmployeeHours[]>([])
  const [weeklyHours, setWeeklyHours] = useState<WeeklyHours[]>([])
  const [orgName, setOrgName] = useState<string>('')
  const [payrollLaunchDate, setPayrollLaunchDate] = useState<string | null>(null)
  const [hasEmployees, setHasEmployees] = useState(false)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null)

  const [allDms, setAllDms] = useState<{ id: string; full_name: string; employee_count: number }[]>([])
  const [dmHours, setDmHours] = useState<EmployeeHours[]>([])

  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 13)
    return d.toISOString().split('T')[0]
  })
  const [to, setTo] = useState(() => new Date().toISOString().split('T')[0])
  const [downloading, setDownloading] = useState(false)

  // Track which DM timecards have been downloaded this session (per period)
  const [downloadedDms, setDownloadedDms] = useState<Record<string, Set<string>>>({})

  async function load() {
    const [meRes, payRes] = await Promise.all([
      fetch('/api/auth/me'),
      fetch('/api/payroll'),
    ])
    const me = await meRes.json()
    setSession(me)
    if (payRes.ok) {
      const data = await payRes.json()
      setPeriods(data.periods ?? [])
      setMyHours(data.myEmployeeHours ?? [])
      setWeeklyHours(data.weeklyHours ?? [])
      setHasEmployees(data.hasEmployees ?? false)
      setOrgName(data.orgName ?? '')
      setPayrollLaunchDate(data.payrollLaunchDate ?? null)
      setAllDms(data.allDms ?? [])
      setDmHours(data.dmHours ?? [])
      // Auto-expand current week
      const current = (data.weeklyHours ?? []).find((w: WeeklyHours) => w.isCurrent)
      if (current && !expandedWeek) setExpandedWeek(current.start)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function showMsg(text: string, type: 'success' | 'error' = 'success') {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 5000)
  }

  async function approve(periodId: string, type: string, dmId?: string) {
    setApproving(periodId + type + (dmId ?? ''))
    try {
      const res = await fetch('/api/payroll/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodId, type, dmId }),
      })
      if (res.ok) {
        if (type === 'dm') showMsg('Timecards locked and submitted. SD has been notified.')
        else if (type === 'sr_approve') showMsg('Timecard approved.')
        else if (type === 'final') showMsg('Payroll submitted to owner. Owner has been notified.')
        else if (type === 'owner_override') showMsg('Override applied. Payroll marked as approved.')
        await load()
      } else {
        const d = await res.json().catch(() => ({}))
        showMsg(d.error ?? 'Action failed', 'error')
      }
    } finally {
      setApproving(null)
    }
  }

  async function downloadDmCsv(dmId: string, periodId: string, periodStart: string, periodEnd: string) {
    const url = `/api/payroll/download?from=${periodStart}&to=${periodEnd}&dmId=${dmId}`
    const res = await fetch(url)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      showMsg(d.error ?? 'No data for this DM', 'error')
      return
    }
    const blob = await res.blob()
    await downloadBlob(blob, `FMP_ADP_Payroll_${periodStart}_to_${periodEnd}_dm.csv`)

    // Mark as downloaded in local state
    setDownloadedDms(prev => {
      const next = { ...prev }
      if (!next[periodId]) next[periodId] = new Set()
      else next[periodId] = new Set(next[periodId])
      next[periodId].add(dmId)
      return next
    })

    // Refresh data so downloaded_at is reflected from server
    await load()
  }

  async function downloadFullCsv() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/payroll/download?from=${from}&to=${to}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        showMsg(d.error ?? 'No data for selected period', 'error')
        return
      }
      const blob = await res.blob()
      await downloadBlob(blob, `FMP_ADP_Payroll_${from}_to_${to}.csv`)
    } finally {
      setDownloading(false)
    }
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />
  if (session.role === 'employee') {
    if (typeof window !== 'undefined') window.location.replace('/dashboard')
    return <div className="min-h-screen bg-gray-950" />
  }

  const role = session.role
  // Show the most recent closed period that isn't fully approved yet;
  // once all closed periods are approved, advance to the current open period
  const now = new Date()
  const closedPeriods = periods.filter(p => new Date(p.period_end + 'T23:59:59') < now)
  const unapprovedClosed = closedPeriods.find(p => p.status !== 'approved')
  const currentPeriod = unapprovedClosed ?? periods[0] ?? null

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-4 pt-6 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6">Payroll</h1>

        {message && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${
            message.type === 'error'
              ? 'bg-red-900/40 border border-red-700 text-red-300'
              : 'bg-green-900/40 border border-green-700 text-green-300'
          }`}>
            {message.text}
          </div>
        )}

        {/* Pre-launch notice */}
        {!loading && (() => {
          const isLaunched = payrollLaunchDate && new Date(payrollLaunchDate + 'T00:00:00') <= new Date()
          if (!isLaunched) {
            return (
              <div className="mb-5 px-4 py-3 rounded-xl bg-blue-950/40 border border-blue-800/40 text-blue-300 text-sm">
                <p className="font-semibold mb-0.5">
                  {payrollLaunchDate
                    ? `Payroll enforcement starts ${new Date(payrollLaunchDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
                    : 'Payroll enforcement not yet active'}
                </p>
                <p className="text-blue-400/80 text-xs">
                  {payrollLaunchDate
                    ? 'Automated reminders and tasks will begin on that date. The workflow is available for testing now.'
                    : 'The workflow is available for testing. Automated reminders will start once a launch date is set.'}
                </p>
              </div>
            )
          }
          return null
        })()}

        {loading ? (
          <p className="text-gray-500 text-sm text-center py-16">Loading…</p>
        ) : (
          <>
            {/* ── DM VIEW ── */}
            {role === 'manager' && (
              <div className="space-y-6">

                {/* Weekly Timecards */}
                {hasEmployees && weeklyHours.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">Weekly Timecards</p>
                    <div className="space-y-2">
                      {weeklyHours.map(week => {
                        const isExpanded = expandedWeek === week.start
                        const totalHours = week.employees.reduce((s, e) => s + e.total_hours, 0)
                        return (
                          <div key={week.start} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                            <button
                              onClick={() => setExpandedWeek(isExpanded ? null : week.start)}
                              className="w-full flex items-center justify-between px-5 py-4 text-left"
                            >
                              <div className="flex items-center gap-3">
                                <div>
                                  <p className="font-semibold text-white text-sm">{fmtWeek(week.start, week.end)}</p>
                                  <p className="text-xs text-gray-500 mt-0.5">
                                    {week.employees.length} employee{week.employees.length !== 1 ? 's' : ''} · {totalHours.toFixed(1)}h total
                                  </p>
                                </div>
                                {week.isCurrent && (
                                  <span className="text-[10px] bg-cyan-900/30 border border-cyan-800/40 text-cyan-400 px-2 py-0.5 rounded-full font-semibold">
                                    Live
                                  </span>
                                )}
                              </div>
                              <svg className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>

                            {isExpanded && (
                              <div className="px-5 pb-4">
                                {week.employees.length === 0 ? (
                                  <p className="text-gray-600 text-sm">No hours recorded this week.</p>
                                ) : (
                                  <div className="bg-gray-800/60 rounded-xl overflow-hidden">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="border-b border-gray-700">
                                          <th className="text-left px-3 py-2 text-xs text-gray-400 font-medium">Employee</th>
                                          <th className="text-right px-3 py-2 text-xs text-gray-400 font-medium">Reg</th>
                                          <th className="text-right px-3 py-2 text-xs text-gray-400 font-medium">OT</th>
                                          <th className="text-right px-3 py-2 text-xs text-gray-400 font-medium">Total</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {week.employees.map(emp => (
                                          <tr key={emp.user_id} className="border-b border-gray-700/50 last:border-0">
                                            <td className="px-3 py-2 text-gray-200">{emp.full_name}</td>
                                            <td className="px-3 py-2 text-right text-gray-300">{emp.regular_hours.toFixed(2)}</td>
                                            <td className={`px-3 py-2 text-right font-medium ${emp.ot_hours > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                                              {emp.ot_hours.toFixed(2)}
                                            </td>
                                            <td className="px-3 py-2 text-right font-semibold text-white">{emp.total_hours.toFixed(2)}</td>
                                          </tr>
                                        ))}
                                        <tr className="border-t border-gray-600">
                                          <td className="px-3 py-2 text-gray-400 font-semibold text-xs uppercase">Total</td>
                                          <td className="px-3 py-2 text-right text-gray-300 font-semibold">
                                            {week.employees.reduce((s, e) => s + e.regular_hours, 0).toFixed(2)}
                                          </td>
                                          <td className={`px-3 py-2 text-right font-semibold ${week.employees.some(e => e.ot_hours > 0) ? 'text-amber-400' : 'text-gray-500'}`}>
                                            {week.employees.reduce((s, e) => s + e.ot_hours, 0).toFixed(2)}
                                          </td>
                                          <td className="px-3 py-2 text-right font-bold text-white">
                                            {totalHours.toFixed(2)}
                                          </td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Biweekly Pay Periods */}
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">Pay Period Submission</p>
                  <div className="space-y-4">
                    {!hasEmployees ? (
                      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                        <p className="text-gray-400 text-sm">No employees are assigned to you yet. Payroll submission will be available once employees are assigned.</p>
                      </div>
                    ) : periods.length === 0 ? (
                      <p className="text-gray-600 text-sm">No payroll periods found.</p>
                    ) : periods.map(period => {
                      const myApproval = period.dmApprovals.find(a => a.dm_id === session.id)
                      const isClosed = new Date(period.period_end + 'T23:59:59Z') < new Date()

                      return (
                        <div key={period.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <p className="font-semibold text-white">{fmtPeriod(period.period_start, period.period_end)}</p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {myApproval ? 'Locked' : 'Open for submission'}
                              </p>
                            </div>
                            <StatusBadge status={period.status} myApproval={!!myApproval} />
                          </div>

                          {/* Employee hours table — show for last closed period */}
                          {isClosed && myHours.length > 0 && (
                            <div className="mb-4">
                              <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">Period Hours Summary</p>
                              <div className="bg-gray-800/60 rounded-xl overflow-hidden">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="border-b border-gray-700">
                                      <th className="text-left px-3 py-2 text-xs text-gray-400 font-medium">Employee</th>
                                      <th className="text-right px-3 py-2 text-xs text-gray-400 font-medium">Reg</th>
                                      <th className="text-right px-3 py-2 text-xs text-gray-400 font-medium">OT</th>
                                      <th className="text-right px-3 py-2 text-xs text-gray-400 font-medium">Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {myHours.map(emp => (
                                      <tr key={emp.user_id} className="border-b border-gray-700/50 last:border-0">
                                        <td className="px-3 py-2 text-gray-200">
                                          <div className="flex items-center gap-2">
                                            {emp.avatar_url
                                              ? <img src={emp.avatar_url} alt={emp.full_name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                                              : <div className="w-6 h-6 rounded-full bg-violet-800 flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0">{emp.full_name.split(' ').map((n: string)=>n[0]).join('').slice(0,2).toUpperCase()}</div>
                                            }
                                            {emp.full_name}
                                          </div>
                                        </td>
                                        <td className="px-3 py-2 text-right text-gray-300">{emp.regular_hours.toFixed(2)}</td>
                                        <td className={`px-3 py-2 text-right font-medium ${emp.ot_hours > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                                          {emp.ot_hours.toFixed(2)}
                                        </td>
                                        <td className="px-3 py-2 text-right font-semibold text-white">{emp.total_hours.toFixed(2)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {isClosed && myHours.length === 0 && !myApproval && (
                            <p className="text-gray-600 text-sm mb-4">No employee hours found for this period.</p>
                          )}

                          {!myApproval && isClosed ? (
                            <div className="space-y-3">
                              <div className="bg-amber-900/20 border border-amber-800/40 rounded-xl px-4 py-3">
                                <p className="text-amber-300 text-xs font-medium">
                                  Review your team's hours above, then lock and submit. Once submitted, timecards are permanently locked.
                                </p>
                              </div>
                              <button
                                onClick={() => approve(period.id, 'dm')}
                                disabled={approving === period.id + 'dm'}
                                className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                              >
                                {approving === period.id + 'dm' ? 'Submitting…' : 'Lock & Submit Timecards'}
                              </button>
                            </div>
                          ) : !myApproval && !isClosed ? (
                            <p className="text-xs text-gray-500 italic">Period closes {new Date(period.period_end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — submit your timecards after close.</p>
                          ) : (
                            <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              Submitted and locked · {fmtDatetime(myApproval!.approved_at)}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── SD / OPS / OWNER / DEV VIEW ── */}
            {role !== 'manager' && (
              <div className="space-y-6">

                {/* Owner override */}
                {(role === 'owner' || role === 'developer') && currentPeriod && currentPeriod.status !== 'approved' && (
                  <div className="bg-red-950/30 border border-red-800/40 rounded-2xl p-5 space-y-3">
                    <div>
                      <p className="text-red-400 text-sm font-semibold">Owner Override</p>
                      <p className="text-red-400/70 text-xs mt-1">
                        This will bypass all DM and SD approval steps and immediately mark the period as approved.
                      </p>
                    </div>
                    <button
                      onClick={() => approve(currentPeriod.id, 'owner_override')}
                      disabled={approving === currentPeriod.id + 'owner_override'}
                      className="w-full py-2.5 rounded-xl bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                    >
                      {approving === currentPeriod.id + 'owner_override' ? 'Applying…' : 'Override & Approve All'}
                    </button>
                  </div>
                )}

                {/* Current period — main review section */}
                {currentPeriod && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">
                      Current Period — {fmtPeriod(currentPeriod.period_start, currentPeriod.period_end)}
                    </p>
                    <div className={`bg-gray-900 border rounded-2xl p-5 space-y-4 ${currentPeriod.status !== 'approved' ? 'border-amber-800/30' : 'border-gray-800'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-white font-semibold">{fmtPeriod(currentPeriod.period_start, currentPeriod.period_end)}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {currentPeriod.dmApprovals.length} of {currentPeriod.totalDMs} DMs submitted &middot; {currentPeriod.srApprovals.filter(a => a.approved_at).length} of {currentPeriod.totalDMs} approved
                          </p>
                        </div>
                        <StatusBadge status={currentPeriod.status} />
                      </div>

                      {/* DM rows */}
                      <DmReviewList
                        period={currentPeriod}
                        session={session}
                        downloadedDms={downloadedDms[currentPeriod.id] ?? new Set()}
                        approving={approving}
                        onDownload={(dmId) => downloadDmCsv(dmId, currentPeriod.id, currentPeriod.period_start, currentPeriod.period_end)}
                        onApprove={(dmId) => approve(currentPeriod.id, 'sr_approve', dmId)}
                        canSr={canSrApprove(role)}
                      />

                      {/* Submit to Owner button */}
                      {canSrApprove(role) &&
                        currentPeriod.status !== 'approved' &&
                        currentPeriod.totalDMs > 0 &&
                        currentPeriod.dmApprovals.length >= currentPeriod.totalDMs &&
                        currentPeriod.srApprovals.filter(a => a.approved_at).length >= currentPeriod.totalDMs && (
                          <div className="space-y-2">
                            <div className="bg-green-900/20 border border-green-800/40 rounded-xl px-4 py-3">
                              <p className="text-green-300 text-xs font-medium">
                                All DMs submitted and approved. Ready to submit to owner for final processing.
                              </p>
                            </div>
                            <button
                              onClick={() => approve(currentPeriod.id, 'final')}
                              disabled={approving === currentPeriod.id + 'final'}
                              className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold text-sm transition-colors"
                            >
                              {approving === currentPeriod.id + 'final'
                                ? 'Submitting…'
                                : `Submit to Owner — ${orgName || 'Payroll'}`}
                            </button>
                          </div>
                        )}

                      {currentPeriod.status === 'approved' && currentPeriod.final_submitted_at && (
                        <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Submitted to owner · {fmtDatetime(currentPeriod.final_submitted_at)}
                          {currentPeriod.final_submitter_name && ` by ${currentPeriod.final_submitter_name}`}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* DM Approval Status */}
                {currentPeriod && allDms.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">DM Approval Status</p>
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-700">
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">DM</th>
                            <th className="text-center px-3 py-3 text-xs text-gray-400 font-medium">Emps</th>
                            <th className="text-center px-3 py-3 text-xs text-gray-400 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allDms.map(dm => {
                            const dmApproval = currentPeriod.dmApprovals.find(a => a.dm_id === dm.id)
                            const srApproval = currentPeriod.srApprovals.find(a => a.dm_id === dm.id)
                            const isApproved = !!srApproval?.approved_at
                            const isSubmitted = !!dmApproval

                            return (
                              <tr key={dm.id} className="border-b border-gray-700/50 last:border-0">
                                <td className="px-4 py-3 text-white font-medium">{dm.full_name}</td>
                                <td className="px-3 py-3 text-center text-gray-400">{dm.employee_count}</td>
                                <td className="px-3 py-3 text-center">
                                  {isApproved ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] bg-green-900/30 border border-green-800/40 text-green-400 px-2.5 py-1 rounded-full font-semibold">
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                      Approved
                                    </span>
                                  ) : isSubmitted ? (
                                    <span className="text-[11px] bg-blue-900/30 border border-blue-800/40 text-blue-400 px-2.5 py-1 rounded-full font-semibold">
                                      Submitted
                                    </span>
                                  ) : (
                                    <span className="text-[11px] bg-amber-900/30 border border-amber-800/40 text-amber-400 px-2.5 py-1 rounded-full font-semibold">
                                      Not Submitted
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      <div className="px-4 py-2.5 bg-gray-800/40 border-t border-gray-700/50">
                        <p className="text-xs text-gray-500">
                          {currentPeriod.dmApprovals.length}/{allDms.length} submitted · {currentPeriod.srApprovals.filter(a => a.approved_at).length}/{allDms.length} approved
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* DM Timecards — hourly DMs */}
                {currentPeriod && dmHours.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">DM Timecards</p>
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-700">
                            <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">DM</th>
                            <th className="text-right px-3 py-3 text-xs text-gray-400 font-medium">Reg</th>
                            <th className="text-right px-3 py-3 text-xs text-gray-400 font-medium">OT</th>
                            <th className="text-right px-3 py-3 text-xs text-gray-400 font-medium">Total</th>
                            <th className="text-center px-3 py-3 text-xs text-gray-400 font-medium">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dmHours.map(dm => {
                            const timeApproval = currentPeriod.dmTimeApprovals?.find(a => a.dm_id === dm.user_id)
                            const isApproved = !!timeApproval
                            const approvingKey = currentPeriod.id + 'dm_time_approve' + dm.user_id

                            return (
                              <tr key={dm.user_id} className="border-b border-gray-700/50 last:border-0">
                                <td className="px-4 py-3 text-white font-medium">{dm.full_name}</td>
                                <td className="px-3 py-3 text-right text-gray-300">{dm.regular_hours.toFixed(2)}</td>
                                <td className={`px-3 py-3 text-right font-medium ${dm.ot_hours > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                                  {dm.ot_hours.toFixed(2)}
                                </td>
                                <td className="px-3 py-3 text-right font-semibold text-white">{dm.total_hours.toFixed(2)}</td>
                                <td className="px-3 py-3 text-center">
                                  {isApproved ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] bg-green-900/30 border border-green-800/40 text-green-400 px-2 py-0.5 rounded-full font-semibold">
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                      Approved
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => approve(currentPeriod.id, 'dm_time_approve', dm.user_id)}
                                      disabled={approving === approvingKey}
                                      className="text-[11px] bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-3 py-1 rounded-full font-semibold transition-colors"
                                    >
                                      {approving === approvingKey ? 'Approving…' : 'Approve'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      <div className="px-4 py-2.5 bg-gray-800/40 border-t border-gray-700/50">
                        <p className="text-xs text-gray-500">
                          {currentPeriod.dmTimeApprovals?.filter(a => dmHours.some(d => d.user_id === a.dm_id)).length ?? 0}/{dmHours.length} DM timecards approved
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Past periods */}
                {(() => {
                  const pastPeriods = closedPeriods.filter(p => p.id !== currentPeriod?.id)
                  return pastPeriods.length > 0 ? (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">Past Periods</p>
                    <div className="space-y-3">
                      {pastPeriods.map(period => (
                        <div key={period.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-semibold text-white text-sm">{fmtPeriod(period.period_start, period.period_end)}</p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {period.dmApprovals.length}/{period.totalDMs} DMs &middot; {period.srApprovals.filter(a => a.approved_at).length}/{period.totalDMs} SR approved
                              </p>
                            </div>
                            <StatusBadge status={period.status} />
                          </div>
                          {period.final_submitter_name && period.final_submitted_at && (
                            <p className="text-xs text-gray-500 mt-2">
                              Submitted to owner by {period.final_submitter_name} · {fmtDatetime(period.final_submitted_at)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  ) : null
                })()}

                {/* ADP CSV Download */}
                {canDownload(role) && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">Download Payroll CSV</p>
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
                      <p className="text-xs text-gray-400">
                        Download an ADP-formatted CSV for any date range. Regular and overtime hours are calculated on a weekly basis (40 hr threshold).
                      </p>
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label className="block text-xs text-gray-500 mb-1">From</label>
                          <input
                            type="date"
                            value={from}
                            onChange={e => setFrom(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs text-gray-500 mb-1">To</label>
                          <input
                            type="date"
                            value={to}
                            onChange={e => setTo(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500"
                          />
                        </div>
                      </div>
                      <button
                        onClick={downloadFullCsv}
                        disabled={downloading}
                        className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        {downloading ? 'Downloading…' : 'Download Full ADP CSV'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── DM Review List ────────────────────────────────────────────────────────────

interface DmReviewListProps {
  period: Period
  session: Session
  downloadedDms: Set<string>
  approving: string | null
  onDownload: (dmId: string) => Promise<void>
  onApprove: (dmId: string) => Promise<void>
  canSr: boolean
}

function DmReviewList({ period, session, downloadedDms, approving, onDownload, onApprove, canSr }: DmReviewListProps) {
  const [downloading, setDownloading] = useState<string | null>(null)

  // Build a full list: submitted DMs from dmApprovals, all else as pending
  const submittedDmIds = new Set(period.dmApprovals.map(a => a.dm_id))

  return (
    <div className="space-y-2">
      {/* DMs who have submitted */}
      {period.dmApprovals.map(dm => {
        const srApproval = period.srApprovals.find(a => a.dm_id === dm.dm_id)
        const isDownloaded = downloadedDms.has(dm.dm_id) || !!srApproval?.downloaded_at
        const isApproved = !!srApproval?.approved_at
        const approvingKey = period.id + 'sr_approve' + dm.dm_id

        async function handleDownload() {
          setDownloading(dm.dm_id)
          await onDownload(dm.dm_id)
          setDownloading(null)
        }

        return (
          <div key={dm.dm_id} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-white">{dm.dm_name}</p>
                <p className="text-xs text-gray-500">Submitted {fmtDatetime(dm.approved_at)}</p>
              </div>
              {isApproved && (
                <span className="text-[10px] bg-green-900/30 border border-green-800/40 text-green-400 px-2 py-0.5 rounded-full font-semibold shrink-0">
                  Approved
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleDownload}
                disabled={downloading === dm.dm_id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-xs font-medium transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {downloading === dm.dm_id ? 'Downloading…' : isDownloaded ? '✓ Downloaded' : 'Download Timecard'}
              </button>

              {/* Edit Timecards link */}
              {canSr && !isApproved && (
                <a
                  href={`/timecards?managerId=${dm.dm_id}&from=${period.period_start}&to=${period.period_end}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  Edit Timecards
                </a>
              )}

              {canSr && isDownloaded && !isApproved && (
                <button
                  onClick={() => onApprove(dm.dm_id)}
                  disabled={approving === approvingKey}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                >
                  {approving === approvingKey ? 'Approving…' : 'Mark Approved'}
                </button>
              )}

              {isApproved && srApproval?.sr_name && (
                <span className="text-xs text-gray-500">by {srApproval.sr_name}</span>
              )}
            </div>
          </div>
        )
      })}

      {/* Pending DMs (not yet submitted) */}
      {period.totalDMs > submittedDmIds.size && Array.from({ length: period.totalDMs - submittedDmIds.size }).map((_, i) => (
        <div key={`pending-${i}`} className="bg-gray-800/30 border border-gray-700/30 rounded-xl px-3 py-2.5 flex items-center justify-between">
          <p className="text-xs text-gray-500 italic">Pending DM submission</p>
          <span className="text-[10px] bg-amber-900/30 border border-amber-800/40 text-amber-400 px-2 py-0.5 rounded-full">Waiting</span>
        </div>
      ))}
    </div>
  )
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, myApproval }: { status: string; myApproval?: boolean }) {
  if (status === 'approved') {
    return (
      <span className="text-[10px] bg-green-900/30 border border-green-800/40 text-green-400 px-2 py-0.5 rounded-full font-semibold shrink-0">
        Approved
      </span>
    )
  }
  if (status === 'pending_sr') {
    return (
      <span className="text-[10px] bg-blue-900/30 border border-blue-800/40 text-blue-400 px-2 py-0.5 rounded-full font-semibold shrink-0">
        Awaiting SR
      </span>
    )
  }
  if (myApproval) {
    return (
      <span className="text-[10px] bg-violet-900/30 border border-violet-800/40 text-violet-400 px-2 py-0.5 rounded-full font-semibold shrink-0">
        Waiting on others
      </span>
    )
  }
  return (
    <span className="text-[10px] bg-amber-900/30 border border-amber-800/40 text-amber-400 px-2 py-0.5 rounded-full font-semibold shrink-0">
      Pending DM
    </span>
  )
}
