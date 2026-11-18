'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'

type Role = 'employee' | 'manager' | 'ops_field_leader' | 'ops_manager' | 'owner' | 'sales_director' | 'developer' | 'prospect'
interface Session { id: string; fullName: string; role: Role; org_id?: string | null }

interface DmStore { id: string; address: string; market?: string }
interface Dm { id: string; name: string; stores: DmStore[] }
interface Market { name: string; storeIds: string[]; dmIds: string[] }

interface Schedule {
  id?: string; employee_id: string; store_id: string | null; store_address: string | null
  shift_date: string; start_time: string | null; end_time: string | null
  break_minutes?: number | null
}
interface Shift {
  id: string; user_id: string; store_id: string | null; store_address: string | null
  clock_in_at: string; clock_out_at: string | null
  is_manual: boolean; manual_note: string | null; duration_seconds: number
}
interface Employee {
  id: string; full_name: string; role: string; username: string
  manager_id: string | null; manager_name: string | null; is_floater: boolean
}

const CST = 'America/Chicago'
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Store color palette — consistent colors for dot system
const STORE_COLORS = [
  '#a855f7', // purple
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#f97316', // orange
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#eab308', // yellow
  '#6366f1', // indigo
]

function getMonday(offset = 0): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: CST }))
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1) + offset * 7)
  return d.toLocaleDateString('en-CA')
}
function getSunday(monday: string): string {
  const d = new Date(monday + 'T12:00:00')
  d.setDate(d.getDate() + 6)
  return d.toLocaleDateString('en-CA')
}
function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday + 'T12:00:00')
    d.setDate(d.getDate() + i)
    return d.toLocaleDateString('en-CA')
  })
}
function fmtShortDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: CST, hour: 'numeric', minute: '2-digit', hour12: true })
}
function fmtSchedTime(time: string | null): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'p' : 'a'
  const hr = h % 12 || 12
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, '0')}${ampm}`
}
function fmtWeekLabel(start: string, end: string): string {
  return `${fmtShortDate(start)} – ${fmtShortDate(end)}, ${new Date(end + 'T12:00:00').getFullYear()}`
}

type Level = 'org' | 'market' | 'dm' | 'store' | 'employee'

export default function WorkforcePage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [loading, setLoading] = useState(true)

  // Data
  const [markets, setMarkets] = useState<Market[]>([])
  const [allStores, setAllStores] = useState<DmStore[]>([])
  const [allDms, setAllDms] = useState<Dm[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [exceptions, setExceptions] = useState<Record<string, number>>({})
  const [closures, setClosures] = useState<Array<{ store_id: string; closure_date: string }>>([])
  const [coveredStoreIds, setCoveredStoreIds] = useState<Set<string>>(new Set())
  const [showUnmanned, setShowUnmanned] = useState(false)

  // Navigation
  const [level, setLevel] = useState<Level>('org')
  const [selectedMarket, setSelectedMarket] = useState('')
  const [selectedDm, setSelectedDm] = useState('')
  const [selectedStore, setSelectedStore] = useState('')
  const [selectedEmployee, setSelectedEmployee] = useState('')
  const [search, setSearch] = useState('')

  // Time edit modal
  const [editEmployeeId, setEditEmployeeId] = useState<string | null>(null)
  const [editShiftId, setEditShiftId] = useState<string | null>(null)
  const [editIn, setEditIn] = useState('')
  const [editOut, setEditOut] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editBreaks, setEditBreaks] = useState<Array<{ id: string; start: string; end: string }>>([])
  const [editBreaksLoading, setEditBreaksLoading] = useState(false)
  const [editIsNew, setEditIsNew] = useState(false) // true = adding new shift, false = editing existing
  const [editStoreId, setEditStoreId] = useState('')
  const [editScheduleInfo, setEditScheduleInfo] = useState<{ start: string; end: string; store: string } | null>(null)

  // Schedule editing modal
  const [schedModal, setSchedModal] = useState<{
    mode: 'create' | 'edit'; shiftId?: string
    employeeId: string; storeId: string; date: string
    startTime: string; endTime: string; breakMin: string
  } | null>(null)
  const [schedSaving, setSchedSaving] = useState(false)
  const [schedError, setSchedError] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  const monday = getMonday(weekOffset)
  const sunday = getSunday(monday)
  const days = weekDays(monday)
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: CST })

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => { if (d) setSession(d) })
  }, [router])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/workforce?weekStart=${monday}&weekEnd=${sunday}`)
      if (!res.ok) return
      const d = await res.json()
      setMarkets(d.markets ?? [])
      setAllStores(d.allStores ?? [])
      setAllDms(d.allDms ?? [])
      setEmployees(d.employees ?? [])
      setSchedules(d.schedules ?? [])
      setShifts(d.shifts ?? [])
      setExceptions(d.exceptions ?? {})
      setClosures(d.closures ?? [])
      setCoveredStoreIds(new Set(d.coveredStoreIds ?? []))
    } finally { setLoading(false) }
  }, [monday, sunday])

  useEffect(() => { if (session) loadData() }, [session, loadData])

  // Auto-set level for DMs and employees
  useEffect(() => {
    if (!session || allDms.length === 0) return
    if (session.role === 'manager') {
      const myDm = allDms.find(d => d.id === session.id)
      if (myDm) { setSelectedDm(session.id); setLevel('dm') }
    } else if (session.role === 'employee') {
      // Employees see their DM's view — find which DM they're under
      const myDm = allDms.find(d => employees.some(e => e.id === session.id && e.manager_id === d.id))
      if (myDm) { setSelectedDm(myDm.id); setLevel('dm') }
    }
  }, [session, allDms, employees])

  // Filtered data based on current level
  const currentMarket = markets.find(m => m.name === selectedMarket)
  const currentDm = allDms.find(d => d.id === selectedDm)
  const currentStore = allStores.find(s => s.id === selectedStore)
  const currentEmployee = employees.find(e => e.id === selectedEmployee)

  // DMs filtered by market (if selected)
  const filteredDms = useMemo(() => {
    if (!selectedMarket || !currentMarket) return allDms
    return allDms.filter(d => currentMarket.dmIds.includes(d.id))
  }, [selectedMarket, currentMarket, allDms])

  // Store employees for a DM
  const dmEmployees = useMemo(() => {
    if (!selectedDm) return employees
    return employees.filter(e => e.manager_id === selectedDm)
  }, [selectedDm, employees])

  // Store color map — assign a consistent color to each store
  const storeColorMap = useMemo(() => {
    const map = new Map<string, string>()
    const stores = selectedDm ? (allDms.find(d => d.id === selectedDm)?.stores ?? []) : allStores
    stores.forEach((s, i) => map.set(s.id, STORE_COLORS[i % STORE_COLORS.length]))
    return map
  }, [selectedDm, allDms, allStores])

  // Employees at a specific store — only those scheduled or working HERE this week
  const storeEmployees = useMemo(() => {
    if (!selectedStore) return []
    const userIds = new Set(shifts.filter(s => s.store_id === selectedStore).map(s => s.user_id))
    const schedUserIds = new Set(schedules.filter(s => s.store_id === selectedStore).map(s => s.employee_id))
    return employees.filter(e => userIds.has(e.id) || schedUserIds.has(e.id)).sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [selectedStore, shifts, schedules, employees])

  // Summary stats
  const summaryStores = useMemo(() => {
    let stores: DmStore[] = allStores
    if (selectedMarket && currentMarket) {
      stores = allStores.filter(s => currentMarket.storeIds.includes(s.id))
    }
    if (selectedDm) {
      const dm = allDms.find(d => d.id === selectedDm)
      stores = dm ? dm.stores : []
    }
    const storeIds = stores.map(s => s.id)
    const openCount = storeIds.filter(id => coveredStoreIds.has(id)).length
    return { total: stores.length, open: openCount, unmanned: stores.length - openCount }
  }, [allStores, selectedMarket, currentMarket, selectedDm, allDms, coveredStoreIds])

  const totalScheduledHours = useMemo(() => {
    let filteredSchedules = schedules
    if (selectedDm) {
      const empIds = new Set(dmEmployees.map(e => e.id))
      filteredSchedules = schedules.filter(s => empIds.has(s.employee_id))
    }
    if (selectedStore) {
      filteredSchedules = filteredSchedules.filter(s => s.store_id === selectedStore)
    }
    let hours = 0
    for (const s of filteredSchedules) {
      if (s.start_time && s.end_time) {
        const [sh, sm] = s.start_time.split(':').map(Number)
        const [eh, em] = s.end_time.split(':').map(Number)
        hours += (eh * 60 + em - sh * 60 - sm) / 60
      }
    }
    return Math.round(hours)
  }, [schedules, selectedDm, selectedStore, dmEmployees])

  const totalExceptions = useMemo(() => {
    let empIds = Object.keys(exceptions)
    if (selectedDm) {
      const dmEmpIds = new Set(dmEmployees.map(e => e.id))
      empIds = empIds.filter(id => dmEmpIds.has(id))
    }
    return empIds.reduce((sum, id) => sum + (exceptions[id] ?? 0), 0)
  }, [exceptions, selectedDm, dmEmployees])

  const totalEmployees = useMemo(() => {
    if (selectedDm) return dmEmployees.length
    return employees.length
  }, [selectedDm, dmEmployees, employees])

  // Search filter
  const searchResults = useMemo(() => {
    if (!search.trim()) return null
    const q = search.toLowerCase()
    const matchedEmployees = employees.filter(e =>
      e.full_name.toLowerCase().includes(q) || e.username.toLowerCase().includes(q)
    ).slice(0, 8)
    const matchedStores = allStores.filter(s => s.address.toLowerCase().includes(q)).slice(0, 5)
    const matchedDms = allDms.filter(d => d.name.toLowerCase().includes(q)).slice(0, 5)
    return { employees: matchedEmployees, stores: matchedStores, dms: matchedDms }
  }, [search, employees, allStores, allDms])

  // Navigation helpers
  // Schedule CRUD
  function openCreateShift(empId: string, storeId: string, day: string) {
    setSchedModal({ mode: 'create', employeeId: empId, storeId, date: day, startTime: '09:00', endTime: '17:00', breakMin: '0' })
    setSchedError('')
  }
  function openEditShift(shiftId: string, empId: string, storeId: string, day: string, start: string, end: string, breakMin: number) {
    setSchedModal({ mode: 'edit', shiftId, employeeId: empId, storeId, date: day, startTime: start.slice(0, 5), endTime: end.slice(0, 5), breakMin: String(breakMin || 0) })
    setSchedError('')
  }
  async function saveSchedule() {
    if (!schedModal) return
    setSchedSaving(true); setSchedError('')
    try {
      if (schedModal.mode === 'create') {
        const res = await fetch('/api/staff-schedule', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeId: schedModal.storeId, employeeId: schedModal.employeeId,
            shiftDate: schedModal.date, startTime: schedModal.startTime, endTime: schedModal.endTime,
            breakMinutes: parseInt(schedModal.breakMin) || 0,
          }),
        })
        if (!res.ok) { const d = await res.json().catch(() => ({})); setSchedError(d.error ?? 'Failed'); setSchedSaving(false); return }
      } else if (schedModal.shiftId) {
        const res = await fetch('/api/staff-schedule', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shiftId: schedModal.shiftId,
            startTime: schedModal.startTime, endTime: schedModal.endTime,
            breakMinutes: parseInt(schedModal.breakMin) || 0,
          }),
        })
        if (!res.ok) { const d = await res.json().catch(() => ({})); setSchedError(d.error ?? 'Failed'); setSchedSaving(false); return }
      }
      setSchedModal(null); loadData()
    } finally { setSchedSaving(false) }
  }
  async function deleteSchedule() {
    if (!schedModal?.shiftId) return
    if (!confirm('Delete this scheduled shift?')) return
    setSchedSaving(true)
    await fetch('/api/staff-schedule', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shiftId: schedModal.shiftId }),
    })
    setSchedModal(null); loadData(); setSchedSaving(false)
  }
  async function publishWeek() {
    if (!selectedStore) return
    if (!confirm(`Publish this week's schedule for ${currentStore?.address}? Employees will be notified.`)) return
    setPublishing(true)
    const res = await fetch('/api/staff-schedule/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: selectedStore, weekStart: monday }),
    })
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error ?? 'Publish failed') }
    setPublishing(false); loadData()
  }
  async function copyPrevWeek() {
    if (!selectedStore) return
    if (!confirm('Copy last week\'s schedule to this week? Existing shifts won\'t be affected.')) return
    await fetch('/api/staff-schedule/copy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: selectedStore, targetWeekStart: monday }),
    })
    loadData()
  }

  function drillTo(newLevel: Level, opts: { market?: string; dm?: string; store?: string; employee?: string } = {}) {
    if (opts.market !== undefined) setSelectedMarket(opts.market)
    if (opts.dm !== undefined) setSelectedDm(opts.dm)
    if (opts.store !== undefined) setSelectedStore(opts.store)
    if (opts.employee !== undefined) setSelectedEmployee(opts.employee)
    setLevel(newLevel)
    setSearch('')
  }

  // Time edit
  function openAddTime(empId: string, day: string) {
    setEditEmployeeId(empId)
    setEditShiftId(null)
    setEditIsNew(true)
    setEditNote('')
    setEditError('')
    setEditBreaks([])
    setEditBreaksLoading(false)
    setEditStoreId('')
    // Look up schedule for this day
    const sched = empScheduleForDay(empId, day)
    if (sched && sched.start_time && sched.end_time) {
      const [sh, sm] = sched.start_time.split(':').map(Number)
      const [eh, em] = sched.end_time.split(':').map(Number)
      setEditIn(`${day}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`)
      setEditOut(`${day}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`)
      setEditScheduleInfo({ start: fmtSchedTime(sched.start_time), end: fmtSchedTime(sched.end_time), store: sched.store_address ?? '' })
      if (sched.store_id) setEditStoreId(sched.store_id)
    } else {
      setEditIn(day + 'T09:00')
      setEditOut(day + 'T17:00')
      setEditScheduleInfo(null)
    }
  }

  async function openTimeEdit(empId: string, shiftId: string, clockIn: string, clockOut: string | null) {
    setEditEmployeeId(empId)
    setEditShiftId(shiftId)
    setEditIsNew(false)
    setEditStoreId('')
    // Look up schedule for this shift's day
    const shiftDay = new Date(clockIn).toLocaleDateString('en-CA', { timeZone: CST })
    const sched = empScheduleForDay(empId, shiftDay)
    if (sched && sched.start_time) {
      setEditScheduleInfo({ start: fmtSchedTime(sched.start_time), end: fmtSchedTime(sched.end_time), store: sched.store_address ?? '' })
    } else {
      setEditScheduleInfo(null)
    }
    const inLocal = new Date(clockIn).toLocaleString('sv-SE', { timeZone: CST }).slice(0, 16)
    const outLocal = clockOut ? new Date(clockOut).toLocaleString('sv-SE', { timeZone: CST }).slice(0, 16) : ''
    setEditIn(inLocal)
    setEditOut(outLocal)
    setEditNote('')
    setEditError('')
    // Load breaks from the shift data we already have, or fetch if needed
    setEditBreaks([])
    setEditBreaksLoading(true)
    try {
      const res = await fetch(`/api/workforce/employee?id=${empId}&weekStart=${monday}&weekEnd=${sunday}`)
      if (res.ok) {
        const d = await res.json()
        const shift = d.shifts?.find((s: { id: string }) => s.id === shiftId)
        if (shift?.breaks) {
          setEditBreaks(shift.breaks.map((b: { id: string; break_start: string; break_end: string | null }) => ({
            id: b.id,
            start: b.break_start ? new Date(b.break_start).toLocaleString('sv-SE', { timeZone: CST }).slice(0, 16) : '',
            end: b.break_end ? new Date(b.break_end).toLocaleString('sv-SE', { timeZone: CST }).slice(0, 16) : '',
          })))
        }
      }
    } catch { /* ignore */ }
    setEditBreaksLoading(false)
  }

  async function saveTimeEdit() {
    if (!editNote.trim()) { setEditError('Reason is required'); return }
    setEditSaving(true)
    setEditError('')
    try {
      if (editIsNew) {
        // Create new shift
        if (!editEmployeeId || !editIn) { setEditError('Clock in time is required'); setEditSaving(false); return }
        const res = await fetch('/api/shifts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: editEmployeeId,
            clockIn: new Date(editIn).toISOString(),
            clockOut: editOut ? new Date(editOut).toISOString() : null,
            note: editNote.trim(),
            storeId: editStoreId || undefined,
          }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          setEditError(d.error ?? 'Failed to add time entry')
          setEditSaving(false)
          return
        }
        setEditEmployeeId(null)
        loadData()
        setEditSaving(false)
        return
      }

      if (!editShiftId) { setEditError('No shift selected'); setEditSaving(false); return }

      // Save shift time edits
      const res = await fetch('/api/shifts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shiftId: editShiftId,
          clockIn: editIn ? new Date(editIn).toISOString() : undefined,
          clockOut: editOut ? new Date(editOut).toISOString() : undefined,
          note: editNote.trim(),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setEditError(d.error ?? 'Save failed')
        return
      }

      // Save break edits — delete existing + re-insert
      for (const brk of editBreaks) {
        if (!brk.id.startsWith('new_') && !brk.start) {
          // Existing break removed — delete it
          await fetch('/api/shifts/breaks', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ breakId: brk.id }),
          }).catch(() => {})
        } else if (brk.start) {
          // Update or create break
          await fetch('/api/shifts/breaks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shiftId: editShiftId,
              breakId: brk.id.startsWith('new_') ? undefined : brk.id,
              breakStart: new Date(brk.start).toISOString(),
              breakEnd: brk.end ? new Date(brk.end).toISOString() : null,
            }),
          }).catch(() => {})
        }
      }

      setEditEmployeeId(null)
      setEditShiftId(null)
      loadData()
    } finally { setEditSaving(false) }
  }

  if (!session) return null

  const canEdit = ['manager', 'ops_manager', 'ops_field_leader', 'owner', 'sales_director', 'developer'].includes(session.role)

  // Helper: get shifts for an employee on a day
  function empShiftsForDay(empId: string, day: string): Shift[] {
    return shifts.filter(s => {
      const d = new Date(s.clock_in_at).toLocaleDateString('en-CA', { timeZone: CST })
      return s.user_id === empId && d === day
    })
  }
  function empScheduleForDay(empId: string, day: string): Schedule | undefined {
    return schedules.find(s => s.employee_id === empId && s.shift_date === day)
  }

  const inputCls = 'bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500'

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="max-w-4xl mx-auto px-4 pt-4">

        {/* Search bar */}
        <div className="relative mb-4">
          <div className="flex items-center bg-gray-900 border border-gray-800 rounded-xl px-3">
            <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search employee, store, or DM..."
              className="flex-1 bg-transparent border-0 px-3 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none" />
            {search && <button onClick={() => setSearch('')} className="text-gray-500 hover:text-white"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>}
          </div>

          {/* Search results dropdown */}
          {searchResults && (searchResults.employees.length > 0 || searchResults.stores.length > 0 || searchResults.dms.length > 0) && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-50 max-h-64 overflow-y-auto">
              {searchResults.dms.map(d => (
                <button key={d.id} onClick={() => drillTo('dm', { dm: d.id })}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-800 flex items-center gap-2 border-b border-gray-800/50">
                  <span className="text-[10px] bg-violet-900/40 text-violet-400 px-1.5 py-0.5 rounded font-semibold">DM</span>
                  <span className="text-sm text-white">{d.name}</span>
                </button>
              ))}
              {searchResults.stores.map(s => (
                <button key={s.id} onClick={() => drillTo('store', { store: s.id })}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-800 flex items-center gap-2 border-b border-gray-800/50">
                  <span className="text-[10px] bg-cyan-900/40 text-cyan-400 px-1.5 py-0.5 rounded font-semibold">Store</span>
                  <span className="text-sm text-white truncate">{s.address}</span>
                </button>
              ))}
              {searchResults.employees.map(e => (
                <button key={e.id} onClick={() => drillTo('employee', { employee: e.id })}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-800 flex items-center gap-2 border-b border-gray-800/50">
                  <span className="text-[10px] bg-green-900/40 text-green-400 px-1.5 py-0.5 rounded font-semibold">Emp</span>
                  <span className="text-sm text-white">{e.full_name}</span>
                  <span className="text-xs text-gray-500">{e.manager_name ? `· ${e.manager_name}` : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Filter dropdowns */}
        {session.role !== 'manager' && session.role !== 'employee' && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
            <button onClick={() => { drillTo('org', { market: '', dm: '', store: '', employee: '' }); setWeekOffset(0) }}
              className="bg-gray-800 border border-gray-700 hover:border-violet-500/40 rounded-xl px-3 py-2 text-xs text-gray-400 hover:text-white font-medium transition-colors col-span-2 sm:col-span-1">
              Reset
            </button>
            <select value={selectedMarket} onChange={e => { drillTo(e.target.value ? 'market' : 'org', { market: e.target.value, dm: '', store: '', employee: '' }) }} className={inputCls}>
              <option value="">All markets</option>
              {markets.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
            <select value={selectedDm} onChange={e => { drillTo(e.target.value ? 'dm' : (selectedMarket ? 'market' : 'org'), { dm: e.target.value, store: '', employee: '' }) }} className={inputCls}>
              <option value="">All DMs</option>
              {filteredDms.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={selectedStore} onChange={e => { drillTo(e.target.value ? 'store' : (selectedDm ? 'dm' : selectedMarket ? 'market' : 'org'), { store: e.target.value, employee: '' }) }} className={inputCls}>
              <option value="">All stores</option>
              {(selectedDm ? (allDms.find(d => d.id === selectedDm)?.stores ?? []) : allStores).map(s => <option key={s.id} value={s.id}>{s.address}</option>)}
            </select>
            <select value={selectedEmployee} onChange={e => { if (e.target.value) drillTo('employee', { employee: e.target.value }); else drillTo(selectedStore ? 'store' : selectedDm ? 'dm' : selectedMarket ? 'market' : 'org', { employee: '' }) }} className={inputCls}>
              <option value="">All employees</option>
              {(selectedStore ? storeEmployees : selectedDm ? dmEmployees : employees).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
        )}

        {/* Breadcrumb + Week nav */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-1 text-xs text-gray-500 flex-wrap">
            <button onClick={() => drillTo('org', { market: '', dm: '', store: '', employee: '' })} className="hover:text-white transition-colors">Org</button>
            {selectedMarket && <><span>›</span><button onClick={() => drillTo('market', { dm: '', store: '', employee: '' })} className="hover:text-white transition-colors">{selectedMarket}</button></>}
            {selectedDm && <><span>›</span><button onClick={() => drillTo('dm', { store: '', employee: '' })} className="hover:text-white transition-colors">{currentDm?.name}</button></>}
            {selectedStore && <><span>›</span><button onClick={() => drillTo('store', { employee: '' })} className="hover:text-white transition-colors truncate max-w-[150px]">{currentStore?.address}</button></>}
            {selectedEmployee && <><span>›</span><span className="text-white">{currentEmployee?.full_name}</span></>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekOffset(w => w - 1)} className="text-gray-400 hover:text-white p-1"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg></button>
            <span className="text-sm text-white font-medium">{fmtWeekLabel(monday, sunday)}</span>
            <button onClick={() => setWeekOffset(w => w + 1)} className="text-gray-400 hover:text-white p-1"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg></button>
            {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} className="text-xs text-violet-400 hover:text-violet-300 ml-1">Today</button>}
          </div>
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm text-center py-16">Loading...</p>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <button onClick={() => setShowUnmanned(v => !v)} className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center hover:border-violet-500/40 transition-colors">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Stores Open</p>
                <p className="text-xl font-bold text-white">{summaryStores.open} <span className="text-gray-500 text-sm font-normal">of {summaryStores.total}</span></p>
                {summaryStores.unmanned > 0 && <p className="text-[10px] text-red-400">{summaryStores.unmanned} no coverage — tap to see</p>}
              </button>
              <button onClick={() => router.push('/staff-schedule')} className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center hover:border-violet-500/40 transition-colors">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Scheduled Hours</p>
                <p className="text-xl font-bold text-white">{totalScheduledHours.toLocaleString()}</p>
                <p className="text-[10px] text-gray-500">{totalEmployees} employees</p>
              </button>
              <button onClick={() => router.push('/timecards')} className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center hover:border-violet-500/40 transition-colors">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Time Exceptions</p>
                <p className="text-xl font-bold text-white">{totalExceptions}</p>
                <p className="text-[10px] text-violet-400">Tap to review</p>
              </button>
            </div>

            {/* Unmanned stores panel */}
            {showUnmanned && summaryStores.unmanned > 0 && (() => {
              let scopedStores: DmStore[] = allStores
              if (selectedMarket && currentMarket) scopedStores = allStores.filter(s => currentMarket.storeIds.includes(s.id))
              if (selectedDm) { const dm = allDms.find(d => d.id === selectedDm); scopedStores = dm ? dm.stores : [] }
              const unmanned = scopedStores.filter(s => !coveredStoreIds.has(s.id))
              return (
                <div className="bg-red-900/20 border border-red-800/40 rounded-2xl p-4 mb-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold text-red-400 uppercase tracking-widest">No Coverage ({unmanned.length})</p>
                    <button onClick={() => setShowUnmanned(false)} className="text-xs text-gray-500 hover:text-white">Close</button>
                  </div>
                  <div className="space-y-2">
                    {unmanned.map(store => {
                      const dm = allDms.find(d => d.stores.some(s => s.id === store.id))
                      return (
                        <div key={store.id} className="flex items-center justify-between bg-gray-900 rounded-xl px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="text-sm text-white font-medium truncate">{store.address}</p>
                            {dm && <p className="text-[10px] text-gray-500">DM: {dm.name}</p>}
                          </div>
                          <span className="text-[10px] font-bold text-red-400 bg-red-900/40 px-2 py-0.5 rounded-full shrink-0">UNMANNED</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* ═══ ORG / MARKET LEVEL — DM Table ═══ */}
            {(level === 'org' || level === 'market') && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800">
                  <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">By DM</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium sticky left-0 bg-gray-900 z-10 min-w-[140px]">DM</th>
                        {days.map((d, i) => (
                          <th key={d} className={`text-center px-2 py-2 text-xs font-medium min-w-[70px] ${d === todayStr ? 'text-violet-400' : 'text-gray-500'}`}>
                            {DAY_NAMES[i]} {new Date(d + 'T12:00:00').getDate()}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDms.map(dm => {
                        const dmEmpIds = new Set(employees.filter(e => e.manager_id === dm.id).map(e => e.id))
                        return (
                          <tr key={dm.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer" onClick={() => drillTo('dm', { dm: dm.id })}>
                            <td className="px-4 py-3 sticky left-0 bg-gray-900 z-10">
                              <p className="text-white font-medium text-sm">{dm.name}</p>
                              <p className="text-[10px] text-gray-500">{dm.stores.length} stores</p>
                            </td>
                            {days.map(day => {
                              const daySchedules = schedules.filter(s => s.shift_date === day && dmEmpIds.has(s.employee_id))
                              const dayShifts = shifts.filter(s => {
                                const sd = new Date(s.clock_in_at).toLocaleDateString('en-CA', { timeZone: CST })
                                return sd === day && dmEmpIds.has(s.user_id)
                              })
                              const scheduledCount = daySchedules.length
                              const workedCount = dayShifts.length
                              const hours = dayShifts.reduce((s, sh) => s + (sh.duration_seconds / 3600), 0)
                              return (
                                <td key={day} className={`text-center px-2 py-3 ${day === todayStr ? 'bg-violet-500/5' : ''}`}>
                                  {scheduledCount > 0 || workedCount > 0 ? (
                                    <>
                                      <p className="text-sm font-semibold text-white">{workedCount}/{scheduledCount}</p>
                                      <p className="text-[10px] text-gray-500">{hours.toFixed(0)}h</p>
                                    </>
                                  ) : (
                                    <span className="text-gray-700">—</span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ═══ DM LEVEL — Store Table ═══ */}
            {level === 'dm' && selectedDm && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800">
                  <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">Stores — {currentDm?.name}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium sticky left-0 bg-gray-900 z-10 min-w-[160px]">Store</th>
                        {days.map((d, i) => (
                          <th key={d} className={`text-center px-2 py-2 text-xs font-medium min-w-[70px] ${d === todayStr ? 'text-violet-400' : 'text-gray-500'}`}>
                            {DAY_NAMES[i]} {new Date(d + 'T12:00:00').getDate()}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(allDms.find(d => d.id === selectedDm)?.stores ?? []).map(store => (
                        <tr key={store.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer" onClick={() => drillTo('store', { store: store.id })}>
                          <td className="px-4 py-3 sticky left-0 bg-gray-900 z-10">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: storeColorMap.get(store.id) ?? '#6b7280' }} />
                              <p className="text-white font-medium text-sm truncate max-w-[180px]">{store.address.split(' ').slice(0, 3).join(' ')}</p>
                            </div>
                          </td>
                          {days.map(day => {
                            const storeSchedules = schedules.filter(s => s.shift_date === day && s.store_id === store.id)
                            const storeShifts = shifts.filter(s => {
                              const sd = new Date(s.clock_in_at).toLocaleDateString('en-CA', { timeZone: CST })
                              return sd === day && s.store_id === store.id
                            })
                            const isClosed = closures.some(c => c.store_id === store.id && c.closure_date === day)
                            if (isClosed) return <td key={day} className="text-center px-2 py-3"><span className="text-[10px] text-red-400">Closed</span></td>
                            return (
                              <td key={day} className={`text-center px-2 py-3 ${day === todayStr ? 'bg-violet-500/5' : ''} ${storeSchedules.length > storeShifts.length ? 'bg-red-500/5' : ''}`}>
                                {storeSchedules.length > 0 || storeShifts.length > 0 ? (
                                  <p className={`text-sm font-semibold ${storeShifts.length >= storeSchedules.length ? 'text-green-400' : 'text-amber-400'}`}>
                                    {storeShifts.length}/{storeSchedules.length}
                                  </p>
                                ) : <span className="text-gray-700">—</span>}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ═══ STORE LEVEL — Employee Schedule Grid ═══ */}
            {level === 'store' && selectedStore && (() => {
              const storeDm = allDms.find(d => d.stores.some(s => s.id === selectedStore))
              const dmStoreList = storeDm?.stores ?? []
              return (
              <div className="space-y-3">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800">
                  <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">{currentStore?.address}</p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {storeEmployees.filter(e => {
                      const todaySchedHere = schedules.some(s => s.store_id === selectedStore && s.shift_date === todayStr && s.employee_id === e.id)
                      const todayShiftHere = shifts.some(s => {
                        const sd = new Date(s.clock_in_at).toLocaleDateString('en-CA', { timeZone: CST })
                        return s.store_id === selectedStore && sd === todayStr && s.user_id === e.id
                      })
                      return todaySchedHere || todayShiftHere
                    }).length} here today · {storeEmployees.length} team total
                  </p>
                  {/* Schedule actions */}
                  {canEdit && (
                    <div className="flex gap-2 mt-2">
                      <button onClick={publishWeek} disabled={publishing}
                        className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white transition-colors">
                        {publishing ? 'Publishing…' : 'Publish Week'}
                      </button>
                      <button onClick={copyPrevWeek}
                        className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
                        Copy Last Week
                      </button>
                    </div>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium sticky left-0 bg-gray-900 z-10 min-w-[140px]">Employee</th>
                        {days.map((d, i) => (
                          <th key={d} className={`text-center px-2 py-2 text-xs font-medium min-w-[80px] ${d === todayStr ? 'text-violet-400' : 'text-gray-500'}`}>
                            {DAY_NAMES[i]} {new Date(d + 'T12:00:00').getDate()}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {storeEmployees.map(emp => (
                        <tr key={emp.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer" onClick={() => drillTo('employee', { employee: emp.id })}>
                          <td className="px-4 py-2 sticky left-0 bg-gray-900 z-10">
                            <p className="text-white font-medium text-xs">{emp.full_name}</p>
                          </td>
                          {days.map(day => {
                            // Only show schedule/shifts AT THIS STORE
                            const sched = schedules.find(s => s.employee_id === emp.id && s.shift_date === day && s.store_id === selectedStore)
                            const dayShifts = shifts.filter(s => {
                              const sd = new Date(s.clock_in_at).toLocaleDateString('en-CA', { timeZone: CST })
                              return s.user_id === emp.id && sd === day && s.store_id === selectedStore
                            })
                            const worked = dayShifts.length > 0
                            const hours = dayShifts.reduce((s, sh) => s + sh.duration_seconds / 3600, 0)
                            const isActive = dayShifts.some(s => !s.clock_out_at)
                            const schedId = sched?.id
                            return (
                              <td key={day} className={`text-center px-2 py-2 ${day === todayStr ? 'bg-violet-500/5' : ''} ${canEdit ? 'cursor-pointer hover:bg-gray-800/50' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (!canEdit) return
                                  if (sched && sched.start_time) {
                                    // Edit existing schedule
                                    openEditShift(schedId ?? '', emp.id, selectedStore, day, sched.start_time, sched.end_time ?? '', sched.break_minutes ?? 0)
                                  } else {
                                    // Create new schedule
                                    openCreateShift(emp.id, selectedStore, day)
                                  }
                                }}>
                                {sched && sched.start_time ? (
                                  <div>
                                    <p className="text-[10px] text-gray-300">{fmtSchedTime(sched.start_time)}–{fmtSchedTime(sched.end_time)}</p>
                                    {worked && <p className="text-[10px] text-green-400">{hours.toFixed(1)}h{isActive ? ' ●' : ''}</p>}
                                    {!worked && day <= todayStr && (
                                      <div>
                                        <p className="text-[10px] text-red-400">No show</p>
                                        {canEdit && (
                                          <button onClick={(e2) => { e2.stopPropagation(); openAddTime(emp.id, day) }}
                                            className="text-[9px] text-violet-400 hover:text-violet-300">+ Add Time</button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ) : worked ? (
                                  <p className="text-[10px] text-green-400">{hours.toFixed(1)}h{isActive ? ' ●' : ''}</p>
                                ) : (
                                  <span className={`text-xs ${canEdit ? 'text-gray-600' : 'text-gray-700'}`}>{canEdit ? '+' : '—'}</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              </div>
              )
            })()}

            {/* ═══ EMPLOYEE LEVEL — Day-by-Day Detail ═══ */}
            {level === 'employee' && selectedEmployee && currentEmployee && (
              <div className="space-y-4">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                  <p className="text-lg font-bold text-white">{currentEmployee.full_name}</p>
                  <p className="text-xs text-gray-500">{currentEmployee.manager_name ? `DM: ${currentEmployee.manager_name}` : ''}</p>
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
                    <p className="text-xs text-gray-500 uppercase mb-1">Scheduled</p>
                    <p className="text-lg font-bold text-white">{schedules.filter(s => s.employee_id === selectedEmployee).length} shifts</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
                    <p className="text-xs text-gray-500 uppercase mb-1">Worked</p>
                    <p className="text-lg font-bold text-white">{(shifts.filter(s => s.user_id === selectedEmployee).reduce((sum, s) => sum + s.duration_seconds / 3600, 0)).toFixed(1)}h</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
                    <p className="text-xs text-gray-500 uppercase mb-1">Exceptions</p>
                    <p className="text-lg font-bold text-white">{exceptions[selectedEmployee] ?? 0}</p>
                  </div>
                </div>

                {/* Day cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {days.map((day, i) => {
                    const sched = empScheduleForDay(selectedEmployee, day)
                    const dayShifts = empShiftsForDay(selectedEmployee, day)
                    const isToday = day === todayStr
                    return (
                      <div key={day} className={`bg-gray-900 border rounded-xl p-3 ${isToday ? 'border-violet-500/40' : 'border-gray-800'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <p className={`text-xs font-semibold ${isToday ? 'text-violet-400' : 'text-gray-400'}`}>{DAY_NAMES[i]}</p>
                          <p className="text-[10px] text-gray-500">{fmtShortDate(day)}</p>
                        </div>
                        {sched && sched.start_time ? (
                          <div>
                            <p className="text-xs text-gray-500 uppercase mb-0.5">Scheduled</p>
                            <p className="text-sm font-semibold text-white">{fmtSchedTime(sched.start_time)}–{fmtSchedTime(sched.end_time)}</p>
                            {sched.store_address && <p className="text-[10px] text-gray-500 truncate">{sched.store_address.split(' ').slice(0, 3).join(' ')}</p>}
                          </div>
                        ) : (
                          <div>
                            <p className="text-xs text-gray-600">Off</p>
                            {canEdit && day <= todayStr && (
                              <button onClick={(e) => { e.stopPropagation(); openAddTime(selectedEmployee, day) }}
                                className="mt-1 text-[10px] text-violet-400 hover:text-violet-300 font-semibold">
                                + Add Time
                              </button>
                            )}
                          </div>
                        )}
                        {dayShifts.map(sh => (
                          <div key={sh.id} className="mt-2 pt-2 border-t border-gray-800">
                            <p className="text-xs text-gray-500 uppercase mb-0.5">Worked</p>
                            <p className="text-xs text-white">In: <span className="font-semibold">{fmtTime(sh.clock_in_at)}</span></p>
                            <p className="text-xs text-white">Out: <span className="font-semibold">{sh.clock_out_at ? fmtTime(sh.clock_out_at) : 'On shift'}</span></p>
                            <p className="text-[10px] text-gray-500">{(sh.duration_seconds / 3600).toFixed(1)}h</p>
                            {canEdit && (
                              <button onClick={(e) => { e.stopPropagation(); openTimeEdit(selectedEmployee, sh.id, sh.clock_in_at, sh.clock_out_at) }}
                                className="mt-1 text-[10px] text-violet-400 hover:text-violet-300 font-semibold">
                                Edit Time
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Time Edit Modal */}
      {editEmployeeId && (editShiftId || editIsNew) && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEditEmployeeId(null)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-2">{editIsNew ? 'Add Time Entry' : 'Edit Time'}</h2>
            {editScheduleInfo && (
              <div className="bg-blue-900/20 border border-blue-800/40 rounded-xl px-3 py-2 mb-4">
                <p className="text-[10px] text-blue-400 uppercase font-semibold mb-0.5">Scheduled</p>
                <p className="text-sm text-white font-medium">{editScheduleInfo.start}–{editScheduleInfo.end}</p>
                {editScheduleInfo.store && <p className="text-[10px] text-gray-400 truncate">{editScheduleInfo.store}</p>}
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Clock In</label>
                <input type="datetime-local" value={editIn} onChange={e => setEditIn(e.target.value)} className={`w-full ${inputCls}`} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Clock Out</label>
                <input type="datetime-local" value={editOut} onChange={e => setEditOut(e.target.value)} className={`w-full ${inputCls}`} />
              </div>
              {/* Store (for new entries) */}
              {editIsNew && allStores.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Store</label>
                  <select value={editStoreId} onChange={e => setEditStoreId(e.target.value)} className={`w-full ${inputCls}`}>
                    <option value="">Select store</option>
                    {(selectedDm ? (allDms.find(d => d.id === selectedDm)?.stores ?? allStores) : allStores).map(s => (
                      <option key={s.id} value={s.id}>{s.address}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Breaks */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-gray-500">Breaks</label>
                  <button type="button" onClick={() => setEditBreaks(prev => [...prev, { id: `new_${Date.now()}`, start: '', end: '' }])}
                    className="text-[10px] text-violet-400 hover:text-violet-300 font-semibold">+ Add Break</button>
                </div>
                {editBreaksLoading ? (
                  <p className="text-xs text-gray-600">Loading breaks...</p>
                ) : editBreaks.length === 0 ? (
                  <p className="text-xs text-gray-600">No breaks recorded</p>
                ) : (
                  <div className="space-y-2">
                    {editBreaks.map((brk, i) => (
                      <div key={brk.id} className="flex items-center gap-2">
                        <div className="flex-1">
                          <input type="datetime-local" value={brk.start}
                            onChange={e => setEditBreaks(prev => prev.map((b, j) => j === i ? { ...b, start: e.target.value } : b))}
                            className={`w-full ${inputCls} text-xs`} placeholder="Break start" />
                        </div>
                        <span className="text-gray-600 text-xs">to</span>
                        <div className="flex-1">
                          <input type="datetime-local" value={brk.end}
                            onChange={e => setEditBreaks(prev => prev.map((b, j) => j === i ? { ...b, end: e.target.value } : b))}
                            className={`w-full ${inputCls} text-xs`} placeholder="Break end" />
                        </div>
                        <button type="button" onClick={() => setEditBreaks(prev => prev.filter((_, j) => j !== i))}
                          className="text-red-400 hover:text-red-300 text-xs shrink-0">Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Reason <span className="text-red-400">*</span></label>
                <textarea value={editNote} onChange={e => setEditNote(e.target.value)} rows={2} placeholder="Required — reason for edit"
                  className={`w-full ${inputCls} resize-none`} />
              </div>
              {editError && <p className="text-xs text-red-400">{editError}</p>}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveTimeEdit} disabled={editSaving || !editNote.trim()}
                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm">
                {editSaving ? 'Saving…' : 'Save Edit'}
              </button>
              <button onClick={() => setEditEmployeeId(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Edit Modal */}
      {schedModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setSchedModal(null)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-sm border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-1">{schedModal.mode === 'create' ? 'Add Shift' : 'Edit Shift'}</h2>
            <p className="text-xs text-gray-500 mb-4">
              {employees.find(e => e.id === schedModal.employeeId)?.full_name} · {new Date(schedModal.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Start Time</label>
                  <input type="time" value={schedModal.startTime}
                    onChange={e => setSchedModal(m => m ? { ...m, startTime: e.target.value } : m)}
                    className={inputCls + ' w-full'} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">End Time</label>
                  <input type="time" value={schedModal.endTime}
                    onChange={e => setSchedModal(m => m ? { ...m, endTime: e.target.value } : m)}
                    className={inputCls + ' w-full'} />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Break (minutes)</label>
                <input type="number" min="0" value={schedModal.breakMin}
                  onChange={e => setSchedModal(m => m ? { ...m, breakMin: e.target.value } : m)}
                  className={inputCls + ' w-full'} placeholder="0" />
              </div>
              {schedError && <p className="text-xs text-red-400">{schedError}</p>}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveSchedule} disabled={schedSaving}
                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm">
                {schedSaving ? 'Saving…' : schedModal.mode === 'create' ? 'Add Shift' : 'Save Changes'}
              </button>
              {schedModal.mode === 'edit' && schedModal.shiftId && (
                <button onClick={deleteSchedule} disabled={schedSaving}
                  className="px-4 py-2.5 bg-red-900/40 hover:bg-red-900/60 border border-red-700/50 text-red-400 font-semibold rounded-xl text-sm">
                  Delete
                </button>
              )}
              <button onClick={() => setSchedModal(null)}
                className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold rounded-xl text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
