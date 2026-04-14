'use client'

import { useState, useEffect, useCallback } from 'react'
import NavBar from '@/components/NavBar'

type Role = 'employee' | 'manager' | 'ops_manager' | 'owner' | 'developer'

interface Session {
  id: string
  fullName: string
  role: Role
  email: string
}

interface Shift {
  id: string
  user_id: string
  clock_in_at: string
  clock_out_at: string | null
  duration_seconds: number
  is_manual: boolean
  manual_note: string | null
  manual_by_name: string | null
  full_name: string
  username: string
}

interface PayCode {
  id: string
  user_id: string
  date: string
  type: 'pto' | 'sick'
  hours: number | null
  note: string | null
  full_name: string
  created_by_name?: string | null
}

interface TeamUser {
  id: string
  full_name: string
  role: string
}

interface EmployeeSummary {
  userId: string
  fullName: string
  totalSeconds: number
  shiftCount: number
  correctionCount: number
  hasLongShift: boolean // any single shift > 10h
  stillClockedIn: boolean
}

const CST = 'America/Chicago'

function fmt(iso: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleString('en-US', { timeZone: CST, ...opts })
}

function fmtTime(iso: string) {
  return fmt(iso, { hour: 'numeric', minute: '2-digit', hour12: true })
}

function fmtDuration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function getWeekMonday(offsetWeeks = 0): Date {
  // Derive today's calendar date in CST/CDT so server (UTC) and client agree
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: CST })
  const [y, m, d] = todayStr.split('-').map(Number)
  // Use noon so toLocalDateStr conversions never cross a day boundary
  const today = new Date(y, m - 1, d, 12, 0, 0)
  const dow = today.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  return new Date(y, m - 1, d + diff + offsetWeeks * 7, 12, 0, 0)
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toLocalDateStr(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: CST })
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const offset = -5 * 60
  const local = new Date(d.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

function shiftDuration(shift: Shift, nowMs: number): number {
  if (shift.clock_out_at) return Number(shift.duration_seconds) || 0
  return (nowMs - new Date(shift.clock_in_at).getTime()) / 1000
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const canManage = (role: Role) =>
  role === 'manager' || role === 'ops_manager' || role === 'owner' || role === 'developer'

const canDownloadRole = (role: Role) => role === 'owner' || role === 'ops_manager' || role === 'developer'

export default function TimecardsPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([])
  const [weekOffset, setWeekOffset] = useState(0)

  // 'all' = team overview, 'individual' = single employee detail
  const [activeView, setActiveView] = useState<'all' | 'individual'>('individual')
  const [selectedUserId, setSelectedUserId] = useState<string>('')

  // Team view data
  const [teamShifts, setTeamShifts] = useState<Shift[]>([])
  const [teamLoading, setTeamLoading] = useState(false)

  // Individual view data
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // Pay codes
  const [payCodes, setPayCodes] = useState<PayCode[]>([])
  const [teamPayCodes, setTeamPayCodes] = useState<PayCode[]>([])
  const [addCodeForDay, setAddCodeForDay] = useState<Date | null>(null)
  const [codeType, setCodeType] = useState<'pto' | 'sick'>('pto')
  const [codeHours, setCodeHours] = useState<string>('')
  const [codeNote, setCodeNote] = useState<string>('')
  const [codeSaving, setCodeSaving] = useState(false)

  // Download state
  const [dlFrom, setDlFrom] = useState('')
  const [dlTo, setDlTo] = useState('')
  const [dlSending, setDlSending] = useState(false)
  const [dlSent, setDlSent] = useState(false)

  // Edit modal
  const [editShift, setEditShift] = useState<Shift | null>(null)
  const [editIn, setEditIn] = useState('')
  const [editOut, setEditOut] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // Add modal
  const [addForDay, setAddForDay] = useState<Date | null>(null)
  const [addIn, setAddIn] = useState('')
  const [addOut, setAddOut] = useState('')
  const [addNote, setAddNote] = useState('')
  const [addSaving, setAddSaving] = useState(false)

  const monday = getWeekMonday(weekOffset)
  const sunday = addDays(monday, 6)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const weekLabel = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  const from = toLocalDateStr(monday)
  const to = toLocalDateStr(addDays(sunday, 1))

  const loadTeamShifts = useCallback(async () => {
    setTeamLoading(true)
    try {
      const r = await fetch(`/api/shifts?team=true&from=${from}&to=${to}T00:00:00`)
      if (r.ok) {
        const d = await r.json()
        setTeamShifts(d.shifts ?? [])
      }
    } finally {
      setTeamLoading(false)
    }
  }, [from, to])

  const targetUserId = selectedUserId || session?.id || ''

  const loadShifts = useCallback(async () => {
    if (!targetUserId) return
    setLoading(true)
    try {
      const r = await fetch(`/api/shifts?userId=${targetUserId}&from=${from}&to=${to}T00:00:00`)
      if (r.ok) {
        const d = await r.json()
        setShifts(d.shifts ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [targetUserId, from, to])

  const loadPayCodes = useCallback(async () => {
    if (!targetUserId) return
    const r = await fetch(`/api/pay-codes?userId=${targetUserId}&from=${from}&to=${to}`)
    if (r.ok) {
      const d = await r.json()
      setPayCodes(d.codes ?? [])
    }
  }, [targetUserId, from, to])

  const loadTeamPayCodes = useCallback(async () => {
    const r = await fetch(`/api/pay-codes?team=true&from=${from}&to=${to}`)
    if (r.ok) {
      const d = await r.json()
      setTeamPayCodes(d.codes ?? [])
    }
  }, [from, to])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then((s: Session) => {
      setSession(s)
      if (canManage(s.role)) {
        setActiveView('all')
        fetch('/api/team/users').then(r => r.json()).then(d => {
          const users = (d.users ?? []).filter((u: TeamUser) => u.role !== 'developer')
          setTeamUsers(users)
        })
      }
      // Default dlFrom/dlTo to current week Mon/Sun
      const mon = getWeekMonday(0)
      const sun = addDays(mon, 6)
      setDlFrom(toLocalDateStr(mon))
      setDlTo(toLocalDateStr(sun))
    })
  }, [])

  useEffect(() => {
    if (activeView === 'all' && session && canManage(session.role)) {
      loadTeamShifts()
      loadTeamPayCodes()
    }
  }, [activeView, loadTeamShifts, loadTeamPayCodes, session])

  useEffect(() => {
    if (activeView === 'individual') {
      loadShifts()
      loadPayCodes()
    }
  }, [activeView, loadShifts, loadPayCodes])

  // Build per-employee summaries from team shifts + team pay codes
  const employeeSummaries: EmployeeSummary[] = (() => {
    const map = new Map<string, EmployeeSummary>()
    for (const s of teamShifts) {
      if (!map.has(s.user_id)) {
        map.set(s.user_id, {
          userId: s.user_id,
          fullName: s.full_name,
          totalSeconds: 0,
          shiftCount: 0,
          correctionCount: 0,
          hasLongShift: false,
          stillClockedIn: false,
        })
      }
      const emp = map.get(s.user_id)!
      const dur = shiftDuration(s, now)
      emp.totalSeconds += dur
      emp.shiftCount++
      if (s.is_manual) emp.correctionCount++
      if (dur > 10 * 3600) emp.hasLongShift = true
      if (!s.clock_out_at) emp.stillClockedIn = true
    }
    // Add PTO hours to totalSeconds (sick is excluded)
    for (const pc of teamPayCodes) {
      if (pc.type !== 'pto') continue
      if (!map.has(pc.user_id)) {
        map.set(pc.user_id, {
          userId: pc.user_id,
          fullName: pc.full_name,
          totalSeconds: 0,
          shiftCount: 0,
          correctionCount: 0,
          hasLongShift: false,
          stillClockedIn: false,
        })
      }
      const emp = map.get(pc.user_id)!
      emp.totalSeconds += Number(pc.hours ?? 0) * 3600
    }
    return Array.from(map.values()).sort((a, b) => a.fullName.localeCompare(b.fullName))
  })()

  function shiftsForDay(day: Date): Shift[] {
    const dateStr = toLocalDateStr(day)
    return shifts.filter(s => {
      const d = new Date(s.clock_in_at).toLocaleDateString('en-CA', { timeZone: CST })
      return d === dateStr
    })
  }

  function payCodesForDay(day: Date): PayCode[] {
    const dateStr = toLocalDateStr(day)
    return payCodes.filter(pc => pc.date.slice(0, 10) === dateStr)
  }

  // Week total includes PTO but not sick
  const ptoSeconds = payCodes
    .filter(pc => pc.type === 'pto')
    .reduce((sum, pc) => sum + Number(pc.hours ?? 0) * 3600, 0)
  const totalSeconds = shifts.reduce((sum, s) => sum + shiftDuration(s, now), 0) + ptoSeconds
  const manualCount = shifts.filter(s => s.is_manual).length

  function openEdit(shift: Shift) {
    setEditShift(shift)
    setEditIn(toDatetimeLocal(shift.clock_in_at))
    setEditOut(shift.clock_out_at ? toDatetimeLocal(shift.clock_out_at) : '')
    setEditNote(shift.manual_note ?? '')
  }

  async function saveEdit() {
    if (!editShift || !editNote.trim()) return
    setEditSaving(true)
    try {
      await fetch('/api/shifts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shiftId: editShift.id,
          clockIn: editIn ? new Date(editIn).toISOString() : null,
          clockOut: editOut ? new Date(editOut).toISOString() : null,
          note: editNote.trim(),
        }),
      })
      setEditShift(null)
      await loadShifts()
    } finally {
      setEditSaving(false)
    }
  }

  function openAdd(day: Date) {
    const iso = day.toISOString().slice(0, 10)
    setAddForDay(day)
    setAddIn(iso + 'T08:00')
    setAddOut(iso + 'T17:00')
    setAddNote('')
  }

  async function saveAdd() {
    if (!addForDay || !selectedUserId || !addNote.trim()) return
    setAddSaving(true)
    try {
      await fetch('/api/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUserId,
          clockIn: new Date(addIn).toISOString(),
          clockOut: addOut ? new Date(addOut).toISOString() : null,
          note: addNote.trim(),
        }),
      })
      setAddForDay(null)
      await loadShifts()
    } finally {
      setAddSaving(false)
    }
  }

  function openAddCode(day: Date) {
    setAddCodeForDay(day)
    setCodeType('pto')
    setCodeHours('')
    setCodeNote('')
  }

  async function saveCode() {
    if (!addCodeForDay || !targetUserId) return
    if (codeType === 'pto' && !codeHours) return
    setCodeSaving(true)
    try {
      await fetch('/api/pay-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: targetUserId,
          date: toLocalDateStr(addCodeForDay),
          type: codeType,
          hours: codeType === 'pto' ? parseFloat(codeHours) : null,
          note: codeNote.trim() || null,
        }),
      })
      setAddCodeForDay(null)
      await loadPayCodes()
    } finally {
      setCodeSaving(false)
    }
  }

  async function deleteCode(id: string) {
    await fetch('/api/pay-codes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    await loadPayCodes()
  }

  async function sendDownload() {
    if (!dlFrom || !dlTo) return
    setDlSending(true)
    setDlSent(false)
    try {
      await fetch('/api/reports/timecard-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: dlFrom, to: dlTo }),
      })
      setDlSent(true)
    } finally {
      setDlSending(false)
    }
  }

  function drillIntoEmployee(userId: string) {
    setSelectedUserId(userId)
    setActiveView('individual')
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  const isMgr = canManage(session.role)
  const selectedUser = teamUsers.find(u => u.id === selectedUserId)
  const viewingName = selectedUser?.full_name ?? session.fullName

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-24 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-4 pt-6 max-w-lg mx-auto">
        <h1 className="text-xl font-bold text-white mb-4">Timecards</h1>

        {/* View tabs for managers */}
        {isMgr && (
          <div className="flex gap-1 mb-4 bg-gray-900 border border-gray-800 rounded-xl p-1">
            <button
              onClick={() => setActiveView('all')}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                activeView === 'all' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              All Employees
            </button>
            <button
              onClick={() => { setActiveView('individual'); if (!selectedUserId) setSelectedUserId(session.id) }}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                activeView === 'individual' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {selectedUserId && selectedUser ? selectedUser.full_name : 'Individual'}
            </button>
          </div>
        )}

        {/* Week navigation */}
        <div className="flex items-center justify-between mb-4 bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5">
          <button onClick={() => setWeekOffset(w => w - 1)} className="text-gray-400 hover:text-white transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="text-center">
            <p className="text-sm font-semibold text-white">{weekLabel}</p>
            {weekOffset === 0 && <p className="text-xs text-violet-400">Current Week</p>}
          </div>
          <button onClick={() => setWeekOffset(w => w + 1)} disabled={weekOffset >= 0} className="text-gray-400 hover:text-white transition-colors p-1 disabled:opacity-30">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* ── ALL EMPLOYEES VIEW ── */}
        {activeView === 'all' && isMgr && (
          <>
            {teamLoading ? (
              <div className="text-center text-gray-500 py-12">Loading…</div>
            ) : employeeSummaries.length === 0 ? (
              <div className="text-center text-gray-600 py-8 text-sm">No time entries found for this week.</div>
            ) : (
              <div className="space-y-2">
                {employeeSummaries.map(emp => (
                  <button
                    key={emp.userId}
                    onClick={() => drillIntoEmployee(emp.userId)}
                    className="w-full text-left bg-gray-900 border border-gray-800 hover:border-violet-500/40 rounded-2xl px-4 py-3.5 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-white text-sm truncate">{emp.fullName}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-xs text-violet-400 font-semibold">
                            {(emp.totalSeconds / 3600).toFixed(1)}h
                          </span>
                          <span className="text-xs text-gray-600">{emp.shiftCount} shift{emp.shiftCount !== 1 ? 's' : ''}</span>
                          {emp.correctionCount > 0 && (
                            <span className="text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                              {emp.correctionCount} corrected
                            </span>
                          )}
                          {emp.stillClockedIn && (
                            <span className="text-[10px] font-semibold bg-green-500/15 text-green-400 border border-green-500/20 px-1.5 py-0.5 rounded-full">
                              Clocked in
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {emp.hasLongShift && (
                          <div className="flex items-center gap-1 bg-red-500/15 border border-red-500/20 text-red-400 text-[10px] font-bold px-2 py-1 rounded-full">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                            </svg>
                            10h+ shift
                          </div>
                        )}
                        <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── INDIVIDUAL VIEW ── */}
        {activeView === 'individual' && (
          <>
            {/* Employee selector for managers */}
            {isMgr && (
              <div className="mb-4">
                <select
                  value={selectedUserId}
                  onChange={e => setSelectedUserId(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value={session.id}>— My Timecard ({session.fullName}) —</option>
                  {teamUsers.filter(u => u.id !== session.id).map(u => (
                    <option key={u.id} value={u.id}>{u.full_name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Summary row */}
            <div className="flex gap-3 mb-5">
              <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Total Hours</p>
                <p className="font-bold text-violet-400">{(totalSeconds / 3600).toFixed(1)}h</p>
              </div>
              <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Shifts</p>
                <p className="font-bold text-white">{shifts.length}</p>
              </div>
              {manualCount > 0 && (
                <div className="flex-1 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-center">
                  <p className="text-xs text-amber-400 mb-1">Corrected</p>
                  <p className="font-bold text-amber-400">{manualCount}</p>
                </div>
              )}
            </div>

            {/* Viewing label */}
            {isMgr && (
              <p className="text-xs text-gray-500 mb-3">
                Viewing: <span className="text-white font-medium">{viewingName}</span>
              </p>
            )}

            {/* Day-by-day breakdown */}
            {loading && shifts.length === 0 && payCodes.length === 0 ? (
              <div className="text-center text-gray-500 py-12">Loading…</div>
            ) : (
              <div className="space-y-3">
                {weekDays.map((day, i) => {
                  const dayShifts = shiftsForDay(day)
                  const dayPayCodes = payCodesForDay(day)
                  const isToday = toLocalDateStr(day) === toLocalDateStr(new Date())
                  const shiftSeconds = dayShifts.reduce((s, sh) => s + shiftDuration(sh, now), 0)
                  const ptoDaySeconds = dayPayCodes
                    .filter(pc => pc.type === 'pto')
                    .reduce((s, pc) => s + Number(pc.hours ?? 0) * 3600, 0)
                  const daySeconds = shiftSeconds + ptoDaySeconds
                  const hasEntries = dayShifts.length > 0 || dayPayCodes.length > 0

                  return (
                    <div key={i} className={`bg-gray-900 border rounded-2xl overflow-hidden ${isToday ? 'border-violet-500/40' : 'border-gray-800'}`}>
                      <div className={`flex items-center justify-between px-4 py-2.5 ${isToday ? 'bg-violet-600/10' : ''}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`text-sm font-semibold ${isToday ? 'text-violet-400' : 'text-white'}`}>{DAY_NAMES[i]}</p>
                          <p className="text-xs text-gray-500">{day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                          {dayPayCodes.some(pc => pc.type === 'sick') && (
                            <span className="text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded-full">Sick</span>
                          )}
                          {dayPayCodes.some(pc => pc.type === 'pto') && (
                            <span className="text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded-full">PTO</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {daySeconds > 0 && <p className="text-xs font-semibold text-gray-400">{fmtDuration(daySeconds)}</p>}
                          {isMgr && selectedUserId && selectedUserId !== session.id && (
                            <>
                              <button
                                onClick={() => openAdd(day)}
                                className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
                              >
                                + Add
                              </button>
                              <button
                                onClick={() => openAddCode(day)}
                                className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
                              >
                                + Code
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {!hasEntries ? (
                        <div className="px-4 pb-3">
                          <p className="text-xs text-gray-600 italic">No entries</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-800/60">
                          {dayShifts.map(shift => (
                            <div key={shift.id} className={`px-4 py-3 ${shift.is_manual ? 'bg-amber-500/5' : ''}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium text-white">{fmtTime(shift.clock_in_at)}</span>
                                    <span className="text-xs text-gray-600">→</span>
                                    <span className="text-sm font-medium text-white">
                                      {shift.clock_out_at ? fmtTime(shift.clock_out_at) : <span className="text-yellow-400">Still clocked in</span>}
                                    </span>
                                    <span className="text-xs text-gray-500">{fmtDuration(shiftDuration(shift, now))}</span>
                                    {shiftDuration(shift, now) > 10 * 3600 && (
                                      <span className="text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded-full">⚠ 10h+</span>
                                    )}
                                    {shift.is_manual && (
                                      <span className="text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-full">⚠ Corrected</span>
                                    )}
                                  </div>
                                  {shift.is_manual && shift.manual_note && (
                                    <p className="text-xs text-amber-300/70 mt-1">Note: {shift.manual_note}</p>
                                  )}
                                  {shift.is_manual && shift.manual_by_name && (
                                    <p className="text-xs text-gray-600 mt-0.5">By: {shift.manual_by_name}</p>
                                  )}
                                </div>
                                {isMgr && selectedUserId && selectedUserId !== session.id && (
                                  <button
                                    onClick={() => openEdit(shift)}
                                    className="text-xs text-gray-500 hover:text-violet-400 transition-colors font-medium shrink-0 mt-0.5"
                                  >
                                    Edit
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}

                          {/* Pay code entries */}
                          {dayPayCodes.map(pc => (
                            <div key={pc.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap min-w-0">
                                {pc.type === 'pto' ? (
                                  <span className="text-[11px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">
                                    PTO {pc.hours != null ? `${pc.hours}h` : ''}
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-semibold bg-red-500/15 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">
                                    Sick Day
                                  </span>
                                )}
                                {pc.note && <span className="text-xs text-gray-500 truncate">{pc.note}</span>}
                              </div>
                              {isMgr && selectedUserId && selectedUserId !== session.id && (
                                <button
                                  onClick={() => deleteCode(pc.id)}
                                  className="text-xs text-gray-600 hover:text-red-400 transition-colors font-medium shrink-0"
                                >
                                  × delete
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {!isMgr && !loading && shifts.length === 0 && payCodes.length === 0 && (
              <div className="text-center text-gray-600 py-8 text-sm">No shifts recorded this week.</div>
            )}
          </>
        )}

        {/* ── DOWNLOAD SECTION ── */}
        {session && canDownloadRole(session.role) && (
          <div className="mt-8 pt-6 border-t border-gray-800">
            <h2 className="text-sm font-semibold text-white mb-3">Download Timecard Report</h2>
            <div className="flex gap-2 mb-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input
                  type="date"
                  value={dlFrom}
                  onChange={e => { setDlFrom(e.target.value); setDlSent(false) }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input
                  type="date"
                  value={dlTo}
                  onChange={e => { setDlTo(e.target.value); setDlSent(false) }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>
            <button
              onClick={sendDownload}
              disabled={dlSending || !dlFrom || !dlTo}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
            >
              {dlSending ? 'Sending…' : dlSent ? 'Report Sent!' : 'Email Report'}
            </button>
            {dlSent && (
              <p className="text-xs text-green-400 text-center mt-2">Report emailed to {session.email}</p>
            )}
          </div>
        )}
      </div>

      {/* Edit shift modal */}
      {editShift && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEditShift(null)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-4">Edit Time Entry</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Clock In</label>
                <input type="datetime-local" value={editIn} onChange={e => setEditIn(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Clock Out</label>
                <input type="datetime-local" value={editOut} onChange={e => setEditOut(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Reason for correction <span className="text-red-400">*</span></label>
                <textarea value={editNote} onChange={e => setEditNote(e.target.value)} rows={2} placeholder="Required — explain the change"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
              </div>
              <p className="text-xs text-amber-400">This entry will be flagged for owner review in the weekly payroll report.</p>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveEdit} disabled={editSaving || !editNote.trim()}
                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
              <button onClick={() => setEditShift(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add entry modal */}
      {addForDay && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setAddForDay(null)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-1">Add Time Entry</h2>
            <p className="text-sm text-gray-500 mb-4">{addForDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Clock In</label>
                <input type="datetime-local" value={addIn} onChange={e => setAddIn(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Clock Out</label>
                <input type="datetime-local" value={addOut} onChange={e => setAddOut(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Reason <span className="text-red-400">*</span></label>
                <textarea value={addNote} onChange={e => setAddNote(e.target.value)} rows={2} placeholder="Required — reason for manual entry"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
              </div>
              <p className="text-xs text-amber-400">This entry will be flagged for owner review in the weekly payroll report.</p>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveAdd} disabled={addSaving || !addNote.trim()}
                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                {addSaving ? 'Adding…' : 'Add Entry'}
              </button>
              <button onClick={() => setAddForDay(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pay code modal */}
      {addCodeForDay && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setAddCodeForDay(null)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-1">Add Pay Code</h2>
            <p className="text-sm text-gray-500 mb-4">{addCodeForDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            <div className="space-y-4">
              {/* Type selector */}
              <div className="flex gap-2">
                <button
                  onClick={() => setCodeType('pto')}
                  className={`flex-1 py-3 rounded-xl text-sm font-semibold border transition-colors ${
                    codeType === 'pto'
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                  }`}
                >
                  PTO
                </button>
                <button
                  onClick={() => setCodeType('sick')}
                  className={`flex-1 py-3 rounded-xl text-sm font-semibold border transition-colors ${
                    codeType === 'sick'
                      ? 'bg-red-600 border-red-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                  }`}
                >
                  Sick Day
                </button>
              </div>

              {/* Hours input (PTO only) */}
              {codeType === 'pto' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Hours <span className="text-red-400">*</span></label>
                  <input
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    value={codeHours}
                    onChange={e => setCodeHours(e.target.value)}
                    placeholder="e.g. 8"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
              )}

              {/* Note */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Note <span className="text-gray-600">(optional)</span></label>
                <textarea
                  value={codeNote}
                  onChange={e => setCodeNote(e.target.value)}
                  rows={2}
                  placeholder="Optional note"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={saveCode}
                disabled={codeSaving || (codeType === 'pto' && !codeHours)}
                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                {codeSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setAddCodeForDay(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-colors"
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
