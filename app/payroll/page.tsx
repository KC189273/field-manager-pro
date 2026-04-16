'use client'

import { useState, useEffect } from 'react'
import NavBar from '@/components/NavBar'

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

interface Period {
  id: string
  period_start: string
  period_end: string
  status: string
  sr_approved_by: string | null
  sr_approved_at: string | null
  sr_approver_name: string | null
  dmApprovals: DmApproval[]
  totalDMs: number
}

interface EmployeeHours {
  user_id: string
  full_name: string
  regular_hours: number
  ot_hours: number
  total_hours: number
}

function fmtPeriod(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const e = new Date(end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${s} – ${e}`
}

const canSrApprove = (role: Role) =>
  role === 'sales_director' || role === 'ops_manager' || role === 'developer'

const canDownload = (role: Role) =>
  role === 'sales_director' || role === 'ops_manager' || role === 'owner' || role === 'developer'

export default function PayrollPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [periods, setPeriods] = useState<Period[]>([])
  const [myHours, setMyHours] = useState<EmployeeHours[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Download state
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  })
  const [to, setTo] = useState(() => new Date().toISOString().split('T')[0])
  const [downloading, setDownloading] = useState(false)

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
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function showMsg(text: string, type: 'success' | 'error' = 'success') {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 4000)
  }

  async function approve(periodId: string, type: 'dm' | 'sr') {
    setApproving(periodId + type)
    try {
      const res = await fetch('/api/payroll/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodId, type }),
      })
      if (res.ok) {
        showMsg(type === 'dm' ? 'Payroll approved for your team.' : 'Payroll approved. Owner has been notified.')
        await load()
      } else {
        const d = await res.json().catch(() => ({}))
        showMsg(d.error ?? 'Failed to approve', 'error')
      }
    } finally {
      setApproving(null)
    }
  }

  async function downloadCsv() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/payroll/download?from=${from}&to=${to}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        showMsg(d.error ?? 'No data for selected period', 'error')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `FMP_ADP_Payroll_${from}_to_${to}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  const role = session.role

  // DM's own approval status for the current period
  const currentPeriod = periods[0]
  const dmAlreadyApproved = currentPeriod?.dmApprovals.some(a => a.dm_id === session.id)

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-4 pt-6 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6">Payroll</h1>

        {message && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${
            message.type === 'error' ? 'bg-red-900/40 border border-red-700 text-red-300' : 'bg-green-900/40 border border-green-700 text-green-300'
          }`}>
            {message.text}
          </div>
        )}

        {loading ? (
          <p className="text-gray-500 text-sm text-center py-16">Loading…</p>
        ) : (
          <>
            {/* ── DM VIEW: Approve their team ── */}
            {role === 'manager' && (
              <div className="space-y-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Payroll Approval</p>
                {periods.length === 0 ? (
                  <p className="text-gray-600 text-sm">No payroll periods found.</p>
                ) : periods.map(period => {
                  const myApproval = period.dmApprovals.find(a => a.dm_id === session.id)
                  return (
                    <div key={period.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <p className="font-semibold text-white">{fmtPeriod(period.period_start, period.period_end)}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {period.dmApprovals.length} of {period.totalDMs} DMs approved
                          </p>
                        </div>
                        <StatusBadge status={period.status} myApproval={!!myApproval} />
                      </div>

                      {/* Employee hours table */}
                      {period.id === currentPeriod?.id && myHours.length > 0 && (
                        <div className="mb-4">
                          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">Your Team's Hours</p>
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
                                    <td className="px-3 py-2 text-gray-200">{emp.full_name}</td>
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

                      {period.id === currentPeriod?.id && myHours.length === 0 && (
                        <p className="text-gray-600 text-sm mb-4">No employee hours found for this period.</p>
                      )}

                      {!myApproval ? (
                        <button
                          onClick={() => approve(period.id, 'dm')}
                          disabled={approving === period.id + 'dm'}
                          className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                        >
                          {approving === period.id + 'dm' ? 'Approving…' : 'Approve Payroll'}
                        </button>
                      ) : (
                        <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Approved by you on {new Date(myApproval.approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── HIGHER ROLES: Approval pipeline + download ── */}
            {role !== 'manager' && (
              <div className="space-y-6">
                {/* Approval pipeline */}
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">Approval Pipeline</p>
                  {periods.length === 0 ? (
                    <p className="text-gray-600 text-sm">No payroll periods found.</p>
                  ) : (
                    <div className="space-y-3">
                      {periods.map(period => {
                        const canApproveNow = canSrApprove(role) && period.status === 'pending_sr'
                        const isPending = period.status === 'pending_dm' || period.status === 'pending_sr'
                        return (
                          <div key={period.id} className={`bg-gray-900 border rounded-2xl p-4 ${isPending ? 'border-amber-800/40' : 'border-gray-800'}`}>
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <p className="font-semibold text-white text-sm">{fmtPeriod(period.period_start, period.period_end)}</p>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <span className="text-[10px] text-gray-500">
                                    DMs: {period.dmApprovals.length}/{period.totalDMs} approved
                                  </span>
                                  {period.sr_approver_name && (
                                    <span className="text-[10px] text-gray-500">
                                      · SR: {period.sr_approver_name}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <StatusBadge status={period.status} />
                            </div>

                            {/* DM approval chips */}
                            {period.dmApprovals.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mb-3">
                                {period.dmApprovals.map(a => (
                                  <span key={a.dm_id} className="text-[10px] bg-green-900/30 border border-green-800/40 text-green-400 px-2 py-0.5 rounded-full">
                                    ✓ {a.dm_name.split(' ')[0]}
                                  </span>
                                ))}
                              </div>
                            )}

                            {canApproveNow && (
                              <button
                                onClick={() => approve(period.id, 'sr')}
                                disabled={approving === period.id + 'sr'}
                                className="w-full py-2.5 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                              >
                                {approving === period.id + 'sr' ? 'Approving…' : 'Approve & Notify Owner'}
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Download section */}
                {canDownload(role) && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-3">Download Payroll CSV</p>
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
                      <p className="text-xs text-gray-400">
                        Download an ADP-formatted CSV for any date range. Enter employee File # in ADP to match records.
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
                        onClick={downloadCsv}
                        disabled={downloading}
                        className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        {downloading ? 'Downloading…' : 'Download ADP CSV'}
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

function StatusBadge({ status, myApproval }: { status: string; myApproval?: boolean }) {
  if (status === 'approved') {
    return (
      <span className="text-[10px] bg-green-900/30 border border-green-800/40 text-green-400 px-2 py-0.5 rounded-full font-semibold">
        Approved
      </span>
    )
  }
  if (status === 'pending_sr') {
    return (
      <span className="text-[10px] bg-blue-900/30 border border-blue-800/40 text-blue-400 px-2 py-0.5 rounded-full font-semibold">
        Awaiting SR
      </span>
    )
  }
  if (myApproval) {
    return (
      <span className="text-[10px] bg-violet-900/30 border border-violet-800/40 text-violet-400 px-2 py-0.5 rounded-full font-semibold">
        Waiting on others
      </span>
    )
  }
  return (
    <span className="text-[10px] bg-amber-900/30 border border-amber-800/40 text-amber-400 px-2 py-0.5 rounded-full font-semibold">
      DM Approval Needed
    </span>
  )
}
