'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import NavBar from '@/components/NavBar'

type Role = 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'

interface Session {
  id: string
  fullName: string
  role: Role
  email: string
}

interface ShiftBreak {
  id: string
  break_start: string
  break_end: string
}

interface Shift {
  id: string
  user_id: string
  clock_in_at: string
  clock_out_at: string | null
  duration_seconds: number
  break_seconds: number
  breaks: ShiftBreak[] | null
  is_manual: boolean
  manual_note: string | null
  manual_by_name: string | null
  shift_note: string | null
  store_name: string | null
  full_name: string
  username: string
  avatar_url?: string | null
  edits: ShiftEdit[] | null
}

interface ShiftEdit {
  old_clock_in: string
  new_clock_in: string
  old_clock_out: string | null
  new_clock_out: string | null
  note: string | null
  edited_by: string
  edited_at: string
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
  avatarUrl?: string | null
  totalSeconds: number
  shiftCount: number
  correctionCount: number
  hasLongShift: boolean // any single shift > 10h
  stillClockedIn: boolean
  clockedInStoreName: string | null
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

function fmtDecimalHours(seconds: number) {
  return (seconds / 3600).toFixed(2) + 'h'
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
  // Use sv-SE locale: gives "YYYY-MM-DD HH:MM:SS" in the target timezone
  return new Date(iso)
    .toLocaleString('sv-SE', { timeZone: CST })
    .slice(0, 16)
    .replace(' ', 'T')
}

function shiftDuration(shift: Shift, nowMs: number): number {
  if (shift.clock_out_at) return Number(shift.duration_seconds) || 0
  return (nowMs - new Date(shift.clock_in_at).getTime()) / 1000
}

// Gross = clock-in to clock-out with no break deduction
function grossSeconds(shift: Shift, nowMs: number): number {
  if (shift.clock_out_at) {
    return (new Date(shift.clock_out_at).getTime() - new Date(shift.clock_in_at).getTime()) / 1000
  }
  return (nowMs - new Date(shift.clock_in_at).getTime()) / 1000
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const canManage = (role: Role) =>
  role === 'manager' || role === 'ops_manager' || role === 'owner' || role === 'sales_director' || role === 'developer'

const canDownloadRole = (role: Role) => role === 'owner' || role === 'sales_director' || role === 'developer' || role === 'manager'

export default function TimecardsPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <TimecardsPage />
    </Suspense>
  )
}

function TimecardsPage() {
  const searchParams = useSearchParams()
  const [session, setSession] = useState<Session | null>(null)
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([])
  const [weekOffset, setWeekOffset] = useState(0)

  // 'all' = team overview, 'individual' = single employee detail
  const [activeView, setActiveView] = useState<'all' | 'individual'>('individual')
  const [selectedUserId, setSelectedUserId] = useState<string>('')

  // OT Watch List
  const [otWatch, setOtWatch] = useState<Array<{ id: string; full_name: string; is_floater: boolean; worked_hours: number; scheduled_remaining: number; projected_hours: number }>>([])
  const [otWeekLabel, setOtWeekLabel] = useState('')
  const [showOtWatch, setShowOtWatch] = useState(false)

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

  // Day detail modal
  const [dayDetail, setDayDetail] = useState<Date | null>(null)

  // Role filter (ops+ only)
  const [roleFilter, setRoleFilter] = useState<'all' | 'employee' | 'manager'>('all')
  const [clockedInOnly, setClockedInOnly] = useState(false)

  // Download state
  const [dlFrom, setDlFrom] = useState('')
  const [dlTo, setDlTo] = useState('')
  const [dlSending, setDlSending] = useState(false)
  const [dlSent, setDlSent] = useState(false)

  // DM Edit Activity
  const [showDmEdits, setShowDmEdits] = useState(false)
  const [dmEdits, setDmEdits] = useState<{
    dm_id: string; dm_name: string; edit_count: number;
    clock_in_changes: number; clock_out_changes: number;
    manual_entries: number; hours_added: number; hours_removed: number
  }[]>([])
  const [dmEditsLoading, setDmEditsLoading] = useState(false)

  async function loadDmEdits() {
    setDmEditsLoading(true)
    const weekStart = getWeekMonday(weekOffset)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    const from = weekStart.toISOString().split('T')[0]
    const to = weekEnd.toISOString().split('T')[0]
    const res = await fetch(`/api/shifts?stats=dm-edits&from=${from}&to=${to}`)
    if (res.ok) {
      const d = await res.json()
      setDmEdits(d.dmEdits ?? [])
    }
    setDmEditsLoading(false)
  }

  // Edit modal
  const [editShift, setEditShift] = useState<Shift | null>(null)
  const [editIn, setEditIn] = useState('')
  const [editOut, setEditOut] = useState('')

  // Convert a datetime-local value to an ISO string in CST/CDT
  // This ensures "12:00 PM" entered anywhere is always saved as 12:00 PM Central
  function toCentralISO(datetimeLocal: string): string {
    // datetime-local gives us "2026-07-22T12:00" — no timezone
    // Append Central offset so it's interpreted as Central time, not the browser's timezone
    // CDT = UTC-5, CST = UTC-6. Detect by checking if the date falls in DST.
    const d = new Date(datetimeLocal)
    const jan = new Date(d.getFullYear(), 0, 1).getTimezoneOffset()
    const jul = new Date(d.getFullYear(), 6, 1).getTimezoneOffset()
    const isDST = d.getTimezoneOffset() < Math.max(jan, jul)
    // For Central: DST = -05:00, Standard = -06:00
    // But we need to use Central's DST, not the browser's
    // Simpler: just use America/Chicago via a fixed approach
    // Treat the input as Central by appending the offset
    const centralOffset = isDSTinCentral(d) ? '-05:00' : '-06:00'
    return new Date(datetimeLocal + centralOffset).toISOString()
  }

  function isDSTinCentral(d: Date): boolean {
    // US DST: second Sunday in March to first Sunday in November
    const year = d.getFullYear()
    const marchSecondSun = new Date(year, 2, 8 + (7 - new Date(year, 2, 8).getDay()) % 7, 2)
    const novFirstSun = new Date(year, 10, 1 + (7 - new Date(year, 10, 1).getDay()) % 7, 2)
    return d >= marchSecondSun && d < novFirstSun
  }
  const [editNote, setEditNote] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // Shift note modal
  const [noteShift, setNoteShift] = useState<Shift | null>(null)
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)

  // Add modal
  const [addForDay, setAddForDay] = useState<Date | null>(null)
  const [addIn, setAddIn] = useState('')
  const [addOut, setAddOut] = useState('')
  const [addNote, setAddNote] = useState('')
  const [addSaving, setAddSaving] = useState(false)

  // Break management modal
  const [breakShift, setBreakShift] = useState<Shift | null>(null)
  const [newBreakStart, setNewBreakStart] = useState('')
  const [newBreakEnd, setNewBreakEnd] = useState('')
  const [breakSaving, setBreakSaving] = useState(false)
  const [breakError, setBreakError] = useState('')

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
    const preselectedUserId = searchParams.get('userId')
    fetch('/api/auth/me').then(r => r.json()).then((s: Session) => {
      setSession(s)
      if (canManage(s.role)) {
        fetch('/api/team/users').then(r => r.json()).then(d => {
          const users = (d.users ?? []).filter((u: TeamUser) => u.role !== 'developer')
          setTeamUsers(users)
          if (preselectedUserId) {
            setSelectedUserId(preselectedUserId)
            setActiveView('individual')
          } else {
            setActiveView('all')
          }
        })
      }
      // Default dlFrom/dlTo to current week Mon/Sun
      const mon = getWeekMonday(0)
      const sun = addDays(mon, 6)
      setDlFrom(toLocalDateStr(mon))
      setDlTo(toLocalDateStr(sun))
    })
  }, [searchParams])

  // Load OT Watch List
  useEffect(() => {
    if (!session || !canManage(session.role)) return
    fetch('/api/ot-watch').then(r => r.json()).then(d => {
      setOtWatch(d.watchList ?? [])
      setOtWeekLabel(d.weekLabel ?? '')
    }).catch(() => {})
  }, [session])

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
          avatarUrl: s.avatar_url,
          totalSeconds: 0,
          shiftCount: 0,
          correctionCount: 0,
          hasLongShift: false,
          stillClockedIn: false,
          clockedInStoreName: null,
        })
      }
      const emp = map.get(s.user_id)!
      const dur = shiftDuration(s, now)
      emp.totalSeconds += dur
      emp.shiftCount++
      if (s.is_manual) emp.correctionCount++
      if (dur > 10 * 3600) emp.hasLongShift = true
      if (!s.clock_out_at) { emp.stillClockedIn = true; emp.clockedInStoreName = s.store_name ?? null }
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
          clockedInStoreName: null,
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

  const [editError, setEditError] = useState('')
  const [addError, setAddError] = useState('')

  async function saveEdit() {
    if (!editShift || !editNote.trim()) return
    setEditSaving(true)
    setEditError('')
    try {
      const res = await fetch('/api/shifts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shiftId: editShift.id,
          clockIn: editIn ? toCentralISO(editIn) : null,
          clockOut: editOut ? toCentralISO(editOut) : null,
          note: editNote.trim(),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setEditError(d.error ?? `Save failed (${res.status}). Please try again.`)
        return
      }
      setEditShift(null)
      await loadShifts()
    } catch {
      setEditError('Network error. Please check your connection and try again.')
    } finally {
      setEditSaving(false)
    }
  }

  function openNote(shift: Shift) {
    setNoteShift(shift)
    setNoteText(shift.shift_note ?? '')
  }

  async function saveNote() {
    if (!noteShift) return
    setNoteSaving(true)
    try {
      await fetch('/api/shifts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftId: noteShift.id, shiftNote: noteText.trim() }),
      })
      setNoteShift(null)
      await loadShifts()
    } finally {
      setNoteSaving(false)
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
    setAddError('')
    try {
      const res = await fetch('/api/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUserId,
          clockIn: toCentralISO(addIn),
          clockOut: addOut ? toCentralISO(addOut) : null,
          note: addNote.trim(),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setAddError(d.error ?? `Save failed (${res.status}). Please try again.`)
        return
      }
      setAddForDay(null)
      await loadShifts()
    } catch {
      setAddError('Network error. Please check your connection and try again.')
    } finally {
      setAddSaving(false)
    }
  }

  function openBreaks(shift: Shift) {
    setBreakShift(shift)
    setBreakError('')
    // Pre-fill with a sensible default: 30 min break starting 4h after clock-in
    const baseMs = new Date(shift.clock_in_at).getTime() + 4 * 3600 * 1000
    const defaultStart = new Date(baseMs).toLocaleString('sv-SE', { timeZone: CST }).slice(0, 16).replace(' ', 'T')
    const defaultEnd = new Date(baseMs + 30 * 60 * 1000).toLocaleString('sv-SE', { timeZone: CST }).slice(0, 16).replace(' ', 'T')
    setNewBreakStart(defaultStart)
    setNewBreakEnd(defaultEnd)
  }

  async function addBreak() {
    if (!breakShift || !newBreakStart || !newBreakEnd) return
    setBreakSaving(true)
    setBreakError('')
    try {
      const res = await fetch('/api/clock/break', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'manual_add',
          shiftId: breakShift.id,
          breakStart: new Date(newBreakStart).toISOString(),
          breakEnd: new Date(newBreakEnd).toISOString(),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setBreakError(data.error ?? 'Failed to add break'); return }
      const updated = await fetch(`/api/shifts?userId=${breakShift.user_id}&from=${from}&to=${to}T00:00:00`)
      if (updated.ok) {
        const d = await updated.json()
        const fresh = (d.shifts ?? []).find((s: Shift) => s.id === breakShift.id)
        if (fresh) setBreakShift(fresh)
        setShifts(d.shifts ?? [])
      }
    } finally {
      setBreakSaving(false)
    }
  }

  async function removeBreak(breakId: string) {
    if (!breakShift) return
    await fetch('/api/clock/break', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ breakId }),
    })
    const updated = await fetch(`/api/shifts?userId=${breakShift.user_id}&from=${from}&to=${to}T00:00:00`)
    if (updated.ok) {
      const d = await updated.json()
      const fresh = (d.shifts ?? []).find((s: Shift) => s.id === breakShift.id)
      if (fresh) setBreakShift(fresh)
      setShifts(d.shifts ?? [])
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

  async function deleteShift(shift: Shift) {
    const label = `${fmtTime(shift.clock_in_at)} – ${shift.clock_out_at ? fmtTime(shift.clock_out_at) : 'in progress'}`
    if (!confirm(`Delete time punch: ${label}?\n\nThis cannot be undone.`)) return
    const res = await fetch('/api/shifts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shiftId: shift.id }),
    })
    if (!res.ok) {
      const d = await res.json()
      alert(d.error ?? 'Delete failed')
      return
    }
    await loadShifts()
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
  const isOpsPlus = session.role === 'ops_manager' || session.role === 'owner' || session.role === 'sales_director' || session.role === 'developer'
  const selectedUser = teamUsers.find(u => u.id === selectedUserId)

  // Role filter map for fast lookup
  const userRoleMap = new Map(teamUsers.map(u => [u.id, u.role]))
  const filteredSummaries = employeeSummaries
    .filter(emp => roleFilter === 'all' || userRoleMap.get(emp.userId) === roleFilter)
    .filter(emp => !clockedInOnly || emp.stillClockedIn)
  const filteredTeamUsers = roleFilter === 'all'
    ? teamUsers
    : teamUsers.filter(u => u.role === roleFilter)
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

        {/* OT Watch List */}
        {isMgr && otWatch.length > 0 && (
          <div className="mb-4">
            <button onClick={() => setShowOtWatch(!showOtWatch)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border transition-colors ${
                otWatch.some(e => e.projected_hours >= 50) ? 'bg-red-900/20 border-red-700/40' :
                otWatch.some(e => e.projected_hours >= 45) ? 'bg-amber-900/20 border-amber-700/40' :
                'bg-gray-900 border-gray-800'
              }`}>
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  {otWatch.some(e => e.projected_hours >= 50) ? '🔴' : otWatch.some(e => e.projected_hours >= 45) ? '🟡' : '⚠️'}
                </span>
                <div>
                  <p className="text-sm font-semibold text-white text-left">OT Watch — {otWeekLabel}</p>
                  <p className="text-xs text-gray-500">{otWatch.length} employee{otWatch.length !== 1 ? 's' : ''} trending 35+ hours</p>
                </div>
              </div>
              <svg className={`w-4 h-4 text-gray-500 transition-transform ${showOtWatch ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showOtWatch && (
              <div className="mt-2 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                {otWatch.map(emp => {
                  const level = emp.projected_hours >= 50 ? 'critical' : emp.projected_hours >= 45 ? 'warning' : 'watch'
                  return (
                    <div key={emp.id} className={`px-4 py-3 border-b border-gray-800/50 last:border-0 ${
                      level === 'critical' ? 'bg-red-900/10' : level === 'warning' ? 'bg-amber-900/10' : ''
                    }`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm text-white font-medium">{emp.full_name}</span>
                          {emp.is_floater && <span className="ml-1.5 text-[10px] bg-sky-900/40 text-sky-400 px-1.5 py-0.5 rounded-full font-semibold">Floater</span>}
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-bold ${
                            level === 'critical' ? 'text-red-400' : level === 'warning' ? 'text-amber-400' : 'text-gray-300'
                          }`}>{emp.projected_hours.toFixed(1)}h</p>
                          <p className="text-[10px] text-gray-600">projected</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        <span className="text-xs text-gray-500">{emp.worked_hours.toFixed(1)}h worked</span>
                        <span className="text-xs text-gray-500">+{emp.scheduled_remaining.toFixed(1)}h scheduled</span>
                        {level === 'critical' && <span className="text-[10px] font-bold text-red-400 bg-red-900/40 px-1.5 py-0.5 rounded">OWNER APPROVAL</span>}
                        {level === 'warning' && <span className="text-[10px] font-bold text-amber-400 bg-amber-900/40 px-1.5 py-0.5 rounded">SD APPROVAL</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
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

        {/* DM Edit Activity — SD/owner/developer only */}
        {isOpsPlus && (
          <div className="mb-4">
            <button
              onClick={() => { setShowDmEdits(!showDmEdits); if (!showDmEdits) loadDmEdits() }}
              className="w-full flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 hover:bg-gray-800/80 transition-colors"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                <span className="text-sm font-semibold text-white">DM Edit Activity</span>
              </div>
              <svg className={`w-4 h-4 text-gray-500 transition-transform ${showDmEdits ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showDmEdits && (
              <div className="mt-2 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                {dmEditsLoading ? (
                  <div className="flex justify-center py-6">
                    <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : dmEdits.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6">No DM edits this week</p>
                ) : (
                  <>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-700">
                          <th className="text-left px-4 py-2.5 text-xs text-gray-400 font-medium">DM</th>
                          <th className="text-center px-2 py-2.5 text-xs text-gray-400 font-medium">Edits</th>
                          <th className="text-center px-2 py-2.5 text-xs text-gray-400 font-medium">Added</th>
                          <th className="text-right px-4 py-2.5 text-xs text-gray-400 font-medium">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dmEdits.map(dm => {
                          const net = dm.hours_added - dm.hours_removed
                          return (
                            <tr key={dm.dm_id} className="border-b border-gray-700/50 last:border-0">
                              <td className="px-4 py-2.5 text-white font-medium">{dm.dm_name}</td>
                              <td className="px-2 py-2.5 text-center">
                                <div className="flex flex-col items-center">
                                  <span className="text-amber-400 font-semibold">{dm.edit_count}</span>
                                  <span className="text-[10px] text-gray-500">
                                    {dm.clock_in_changes > 0 && `${dm.clock_in_changes} in`}
                                    {dm.clock_in_changes > 0 && dm.clock_out_changes > 0 && ' · '}
                                    {dm.clock_out_changes > 0 && `${dm.clock_out_changes} out`}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 py-2.5 text-center">
                                {dm.manual_entries > 0 ? (
                                  <span className="text-blue-400 font-semibold">{dm.manual_entries}</span>
                                ) : (
                                  <span className="text-gray-600">0</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                {(dm.hours_added > 0 || dm.hours_removed > 0) ? (
                                  <div className="flex flex-col items-end">
                                    {dm.hours_added > 0 && <span className="text-green-400 text-xs">+{dm.hours_added.toFixed(1)}h</span>}
                                    {dm.hours_removed > 0 && <span className="text-red-400 text-xs">−{dm.hours_removed.toFixed(1)}h</span>}
                                    <span className={`text-xs font-semibold ${net > 0 ? 'text-green-400' : net < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                                      {net > 0 ? '+' : ''}{net.toFixed(1)}h net
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-gray-600 text-xs">—</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <div className="px-4 py-2 bg-gray-800/40 border-t border-gray-700/50">
                      <p className="text-[10px] text-gray-500">
                        Showing edits for {weekLabel}. &quot;Edits&quot; = time corrections, &quot;Added&quot; = manual entries.
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── ALL EMPLOYEES VIEW ── */}
        {activeView === 'all' && isMgr && (
          <>
            {/* Filters row */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {/* Role filter — ops+ only */}
              {isOpsPlus && (
                <>
                  {(['all', 'employee', 'manager'] as const).map(r => (
                    <button
                      key={r}
                      onClick={() => setRoleFilter(r)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                        roleFilter === r
                          ? 'bg-violet-600 border-violet-500 text-white'
                          : 'bg-gray-900 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
                      }`}
                    >
                      {r === 'all' ? 'All' : r === 'employee' ? 'Employees' : 'DMs'}
                    </button>
                  ))}
                  <div className="w-px h-4 bg-gray-700 mx-1" />
                </>
              )}
              {/* Clocked-in toggle — all managers */}
              <button
                onClick={() => setClockedInOnly(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                  clockedInOnly
                    ? 'bg-green-700/30 border-green-600/50 text-green-400'
                    : 'bg-gray-900 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${clockedInOnly ? 'bg-green-400' : 'bg-gray-600'}`} />
                Clocked In
              </button>
            </div>
            {teamLoading ? (
              <div className="text-center text-gray-500 py-12">Loading…</div>
            ) : filteredSummaries.length === 0 ? (
              <div className="text-center text-gray-600 py-8 text-sm">
                {clockedInOnly ? 'No one is currently clocked in.' : 'No time entries found for this week.'}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredSummaries.map(emp => (
                  <button
                    key={emp.userId}
                    onClick={() => drillIntoEmployee(emp.userId)}
                    className="w-full text-left bg-gray-900 border border-gray-800 hover:border-violet-500/40 rounded-2xl px-4 py-3.5 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {emp.avatarUrl
                          ? <img src={emp.avatarUrl} alt={emp.fullName} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                          : <div className="w-8 h-8 rounded-full bg-violet-800 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">{emp.fullName.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}</div>
                        }
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-white text-sm truncate">{emp.fullName}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-xs text-violet-400 font-semibold">
                            {(emp.totalSeconds / 3600).toFixed(2)}h
                          </span>
                          <span className="text-xs text-gray-600">{emp.shiftCount} shift{emp.shiftCount !== 1 ? 's' : ''}</span>
                          {emp.correctionCount > 0 && (
                            <span className="text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                              {emp.correctionCount} corrected
                            </span>
                          )}
                          {emp.stillClockedIn && (
                            <span className="text-[10px] font-semibold bg-green-500/15 text-green-400 border border-green-500/20 px-1.5 py-0.5 rounded-full">
                              Clocked in{emp.clockedInStoreName ? ` @ ${emp.clockedInStoreName}` : ''}
                            </span>
                          )}
                        </div>
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
                <p className="font-bold text-violet-400">{(totalSeconds / 3600).toFixed(2)}h</p>
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
                      <button
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-left ${isToday ? 'bg-violet-600/10' : ''} ${hasEntries ? 'hover:bg-gray-800/50 active:bg-gray-800' : ''}`}
                        onClick={() => hasEntries && setDayDetail(day)}
                      >
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
                          {daySeconds > 0 && <p className="text-xs font-semibold text-violet-400">{fmtDecimalHours(daySeconds)}</p>}
                          {hasEntries && <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>}
                          {isMgr && selectedUserId && selectedUserId !== session.id && (
                            <>
                              <button
                                onClick={e => { e.stopPropagation(); openAdd(day) }}
                                className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
                              >
                                + Add
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); openAddCode(day) }}
                                className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
                              >
                                + Code
                              </button>
                            </>
                          )}
                        </div>
                      </button>

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
                                    {shift.store_name && (
                                      <span className="text-xs text-gray-500">@ {shift.store_name}</span>
                                    )}
                                    <span className="text-xs text-gray-500">{fmtDecimalHours(shiftDuration(shift, now))}</span>
                                    {Number(shift.break_seconds) > 0 && (
                                      <span className="text-xs text-gray-600">−{fmtDecimalHours(Number(shift.break_seconds))} break</span>
                                    )}
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
                                  {shift.edits && shift.edits.length > 0 && (
                                    <div className="mt-1.5 space-y-1">
                                      {shift.edits.map((edit, ei) => {
                                        const oldDur = edit.old_clock_out ? (new Date(edit.old_clock_out).getTime() - new Date(edit.old_clock_in).getTime()) / 3600000 : 0
                                        const newDur = edit.new_clock_out ? (new Date(edit.new_clock_out).getTime() - new Date(edit.new_clock_in).getTime()) / 3600000 : 0
                                        const diff = newDur - oldDur
                                        return (
                                          <div key={ei} className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
                                            <div className="flex items-center gap-2 flex-wrap text-[11px]">
                                              <span className="text-gray-500 line-through">{fmtTime(edit.old_clock_in)} – {edit.old_clock_out ? fmtTime(edit.old_clock_out) : '?'}</span>
                                              <span className="text-gray-600">→</span>
                                              <span className="text-amber-300 font-medium">{fmtTime(edit.new_clock_in)} – {edit.new_clock_out ? fmtTime(edit.new_clock_out) : '?'}</span>
                                              {diff !== 0 && (
                                                <span className={`font-semibold ${diff > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                  {diff > 0 ? '+' : ''}{diff.toFixed(2)}h
                                                </span>
                                              )}
                                            </div>
                                            <p className="text-[10px] text-gray-500 mt-0.5">
                                              {edit.edited_by} · {fmt(edit.edited_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                              {edit.note && <> · {edit.note}</>}
                                            </p>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}
                                  {shift.shift_note && (
                                    <p className="text-xs text-blue-300/80 mt-1">📝 {shift.shift_note}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0 mt-0.5">
                                  <button
                                    onClick={() => openNote(shift)}
                                    className="text-xs text-gray-500 hover:text-blue-400 transition-colors font-medium"
                                  >
                                    {shift.shift_note ? 'Edit note' : 'Add note'}
                                  </button>
                                  {isMgr && selectedUserId && selectedUserId !== session.id && (
                                    <>
                                      <button
                                        onClick={() => openBreaks(shift)}
                                        className="text-xs text-gray-500 hover:text-orange-400 transition-colors font-medium"
                                      >
                                        Breaks
                                      </button>
                                      <button
                                        onClick={() => openEdit(shift)}
                                        className="text-xs text-gray-500 hover:text-violet-400 transition-colors font-medium"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => deleteShift(shift)}
                                        className="text-xs text-gray-600 hover:text-red-400 transition-colors font-medium"
                                      >
                                        Delete
                                      </button>
                                    </>
                                  )}
                                </div>
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

      {/* Shift note modal */}
      {noteShift && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setNoteShift(null)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-1">Shift Note</h2>
            <p className="text-sm text-gray-500 mb-4">{fmtTime(noteShift.clock_in_at)} – {noteShift.clock_out_at ? fmtTime(noteShift.clock_out_at) : 'In progress'}</p>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={3}
              placeholder="Add a note about this shift…"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex gap-2 mt-4">
              <button onClick={saveNote} disabled={noteSaving}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                {noteSaving ? 'Saving…' : 'Save Note'}
              </button>
              <button onClick={() => setNoteShift(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
              {editError && (
                <div className="bg-red-900/40 border border-red-700 rounded-xl px-3 py-2 text-sm text-red-300">{editError}</div>
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveEdit} disabled={editSaving || !editNote.trim()}
                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
              <button onClick={() => { setEditShift(null); setEditError('') }}
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
              {addError && (
                <div className="bg-red-900/40 border border-red-700 rounded-xl px-3 py-2 text-sm text-red-300">{addError}</div>
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveAdd} disabled={addSaving || !addNote.trim()}
                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                {addSaving ? 'Adding…' : 'Add Entry'}
              </button>
              <button onClick={() => { setAddForDay(null); setAddError('') }}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Day detail modal */}
      {dayDetail && (() => {
        const detailShifts = shiftsForDay(dayDetail)
        const detailPayCodes = payCodesForDay(dayDetail)
        const dayLabel = dayDetail.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
        const totalNet = detailShifts.reduce((s, sh) => s + shiftDuration(sh, now), 0)
        const totalBreak = detailShifts.reduce((s, sh) => s + Number(sh.break_seconds), 0)
        const totalGross = detailShifts.reduce((s, sh) => s + grossSeconds(sh, now), 0)
        const ptoSecs = detailPayCodes.filter(pc => pc.type === 'pto').reduce((s, pc) => s + Number(pc.hours ?? 0) * 3600, 0)
        return (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setDayDetail(null)}>
            <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">{dayLabel}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Time breakdown</p>
                </div>
                <button onClick={() => setDayDetail(null)} className="text-gray-500 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {detailShifts.length === 0 && detailPayCodes.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No entries for this day.</p>
              ) : (
                <div className="space-y-3">
                  {detailShifts.map((shift, idx) => {
                    const gross = grossSeconds(shift, now)
                    const brk = Number(shift.break_seconds)
                    const net = shiftDuration(shift, now)
                    return (
                      <div key={shift.id} className={`bg-gray-800/60 border rounded-xl p-4 ${shift.is_manual ? 'border-amber-500/30' : 'border-gray-700/60'}`}>
                        {detailShifts.length > 1 && (
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-2">Shift {idx + 1}</p>
                        )}
                        {shift.store_name && (
                          <div className="flex justify-between items-center text-sm mb-3">
                            <span className="text-gray-400">Store</span>
                            <span className="text-white font-medium">{shift.store_name}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center text-sm mb-3">
                          <span className="text-gray-400">Clock In</span>
                          <span className="text-white font-medium">{fmtTime(shift.clock_in_at)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm mb-3">
                          <span className="text-gray-400">Clock Out</span>
                          <span className={shift.clock_out_at ? 'text-white font-medium' : 'text-yellow-400 font-medium'}>
                            {shift.clock_out_at ? fmtTime(shift.clock_out_at) : 'Still clocked in'}
                          </span>
                        </div>
                        <div className="border-t border-gray-700/60 my-2" />
                        <div className="flex justify-between items-center text-sm mb-1.5">
                          <span className="text-gray-400">Gross Time</span>
                          <span className="text-white">{fmtDecimalHours(gross)}</span>
                        </div>
                        {shift.breaks && shift.breaks.length > 0 && (
                          <div className="mb-1.5">
                            {shift.breaks.map((b, bi) => {
                              const bSecs = (new Date(b.break_end).getTime() - new Date(b.break_start).getTime()) / 1000
                              return (
                                <div key={bi} className="flex justify-between items-center text-sm mb-1">
                                  <span className="text-gray-500 pl-2">
                                    ↳ Break {shift.breaks!.length > 1 ? bi + 1 : ''} {fmtTime(b.break_start)} – {fmtTime(b.break_end)}
                                  </span>
                                  <span className="text-red-400">−{fmtDecimalHours(bSecs)}</span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                        {brk > 0 && (
                          <div className="flex justify-between items-center text-sm mb-1.5">
                            <span className="text-gray-400">{shift.breaks && shift.breaks.length > 1 ? 'Total Break' : 'Break Deducted'}</span>
                            <span className="text-red-400">−{fmtDecimalHours(brk)}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center text-sm font-semibold">
                          <span className="text-gray-300">Net Hours</span>
                          <span className="text-violet-400">{fmtDecimalHours(net)}</span>
                        </div>
                        {shift.is_manual && shift.manual_note && (
                          <p className="text-xs text-amber-300/70 mt-2 pt-2 border-t border-gray-700/60">⚠ Corrected: {shift.manual_note}</p>
                        )}
                        {shift.edits && shift.edits.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-gray-700/60 space-y-1.5">
                            <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">Edit History</p>
                            {shift.edits.map((edit, ei) => {
                              const oldDur = edit.old_clock_out ? (new Date(edit.old_clock_out).getTime() - new Date(edit.old_clock_in).getTime()) / 3600000 : 0
                              const newDur = edit.new_clock_out ? (new Date(edit.new_clock_out).getTime() - new Date(edit.new_clock_in).getTime()) / 3600000 : 0
                              const diff = newDur - oldDur
                              return (
                                <div key={ei} className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
                                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                                    <span className="text-gray-500 line-through">{fmtTime(edit.old_clock_in)} – {edit.old_clock_out ? fmtTime(edit.old_clock_out) : '?'}</span>
                                    <span className="text-gray-600">→</span>
                                    <span className="text-amber-300 font-medium">{fmtTime(edit.new_clock_in)} – {edit.new_clock_out ? fmtTime(edit.new_clock_out) : '?'}</span>
                                    {diff !== 0 && (
                                      <span className={`font-semibold ${diff > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        {diff > 0 ? '+' : ''}{diff.toFixed(2)}h
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-gray-500 mt-0.5">
                                    {edit.edited_by} · {fmt(edit.edited_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                    {edit.note && <> · {edit.note}</>}
                                  </p>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {detailPayCodes.map(pc => (
                    <div key={pc.id} className={`bg-gray-800/60 border rounded-xl p-4 ${pc.type === 'pto' ? 'border-blue-500/30' : 'border-red-500/30'}`}>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-400">{pc.type === 'pto' ? 'PTO' : 'Sick Day'}</span>
                        {pc.type === 'pto' && pc.hours != null && (
                          <span className="text-blue-400 font-semibold">{fmtDecimalHours(pc.hours * 3600)}</span>
                        )}
                      </div>
                      {pc.note && <p className="text-xs text-gray-500 mt-1">{pc.note}</p>}
                    </div>
                  ))}

                  {/* Day total */}
                  <div className="bg-violet-600/10 border border-violet-500/30 rounded-xl p-4">
                    {detailShifts.length > 0 && (
                      <>
                        <div className="flex justify-between items-center text-sm mb-1.5">
                          <span className="text-gray-400">Total Gross</span>
                          <span className="text-white">{fmtDecimalHours(totalGross)}</span>
                        </div>
                        {totalBreak > 0 && (
                          <div className="flex justify-between items-center text-sm mb-1.5">
                            <span className="text-gray-400">Total Breaks</span>
                            <span className="text-red-400">−{fmtDecimalHours(totalBreak)}</span>
                          </div>
                        )}
                      </>
                    )}
                    {ptoSecs > 0 && (
                      <div className="flex justify-between items-center text-sm mb-1.5">
                        <span className="text-gray-400">PTO</span>
                        <span className="text-blue-400">{fmtDecimalHours(ptoSecs)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-base font-bold">
                      <span className="text-white">Day Total</span>
                      <span className="text-violet-400">{fmtDecimalHours(totalNet + ptoSecs)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}

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

      {/* Manage Breaks modal */}
      {breakShift && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setBreakShift(null)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-1">Manage Breaks</h2>
            <p className="text-sm text-gray-500 mb-4">
              {fmtTime(breakShift.clock_in_at)} – {breakShift.clock_out_at ? fmtTime(breakShift.clock_out_at) : 'In progress'}
            </p>

            {/* Existing breaks */}
            {breakShift.breaks && breakShift.breaks.length > 0 ? (
              <div className="mb-4 space-y-2">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Recorded Breaks</p>
                {breakShift.breaks.map((b, i) => {
                  const bSecs = (new Date(b.break_end).getTime() - new Date(b.break_start).getTime()) / 1000
                  return (
                    <div key={b.id} className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2.5">
                      <div>
                        <p className="text-sm text-white font-medium">
                          Break {breakShift.breaks!.length > 1 ? i + 1 : ''}: {fmtTime(b.break_start)} – {fmtTime(b.break_end)}
                        </p>
                        <p className="text-xs text-orange-400">{fmtDecimalHours(bSecs)} deducted</p>
                      </div>
                      <button
                        onClick={() => removeBreak(b.id)}
                        className="text-xs text-gray-600 hover:text-red-400 transition-colors font-medium ml-3"
                      >
                        Remove
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-600 italic mb-4">No breaks recorded for this shift.</p>
            )}

            {/* Add new break */}
            <div className="border-t border-gray-800 pt-4 space-y-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Add Break</p>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Start</label>
                  <input
                    type="datetime-local"
                    value={newBreakStart}
                    onChange={e => setNewBreakStart(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">End</label>
                  <input
                    type="datetime-local"
                    value={newBreakEnd}
                    onChange={e => setNewBreakEnd(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>
              {breakError && <p className="text-xs text-red-400">{breakError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={addBreak}
                  disabled={breakSaving || !newBreakStart || !newBreakEnd}
                  className="flex-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                >
                  {breakSaving ? 'Adding…' : 'Add Break'}
                </button>
                <button
                  onClick={() => setBreakShift(null)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
