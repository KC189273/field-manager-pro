'use client'

import { useState, useEffect, useCallback } from 'react'
import NavBar from '@/components/NavBar'
import { currentWeekStart, weekDays, formatWeekRange, DAY_NAMES } from '@/lib/schedule'

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const GANTT_START = 6   // 6 AM
const GANTT_END   = 23  // 11 PM
const GANTT_SPAN  = GANTT_END - GANTT_START

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface Store {
  id: string
  address: string
  org_id: string | null
}

interface Employee {
  id: string
  full_name: string
  role: string
}

interface Shift {
  id: string
  store_location_id: string
  store_address: string
  employee_id: string | null
  employee_name: string | null
  shift_date: string   // YYYY-MM-DD
  start_time: string   // HH:MM:SS
  end_time: string
  role_note: string | null
  break_minutes: number
  is_on_call: boolean
  is_dm_shift: boolean
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function timeToHours(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}

export default function StaffSchedulePage() {
  const [session, setSession] = useState<Session | null>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [isPublished, setIsPublished] = useState(false)
  const [loading, setLoading] = useState(true)

  // Navigation
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedStore, setSelectedStore] = useState('')
  const [view, setView] = useState<'list' | 'gantt' | 'employee'>('list')
  const [ganttDay, setGanttDay] = useState(() => {
    const d = new Date().getDay()
    return d === 0 ? 6 : d - 1  // convert JS Sun=0 to Mon=0 index
  })

  // Modal
  const [modal, setModal] = useState<'add' | 'edit' | null>(null)
  const [editingShift, setEditingShift] = useState<Shift | null>(null)
  const [form, setForm] = useState({
    employeeId: '',
    storeId: '',
    shiftDate: '',
    startTime: '09:45',
    endTime: '19:00',
    roleNote: '',
    breakMinutes: 0,
    isOnCall: false,
    isDmShift: false,
    selectedDays: [] as string[],
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [copying, setCopying] = useState(false)
  const [modalError, setModalError] = useState('')

  // Schedule validation flags
  interface ScheduleFlag { type: string; date: string; detail: string; employeeId?: string; employeeName?: string; storeId?: string; storeAddress?: string }
  const [scheduleFlags, setScheduleFlags] = useState<ScheduleFlag[]>([])
  const [validateLoading, setValidateLoading] = useState(false)
  const [showFlagsPanel, setShowFlagsPanel] = useState(true)
  const [publishWithFlags, setPublishWithFlags] = useState(false)

  // Dashboard (compliance)
  const [pageTab, setPageTab] = useState<'dashboard' | 'schedule'>('schedule')
  interface ComplianceStore {
    store_id: string
    store_address: string
    dm_name: string | null
    week1_published_at: string | null
    week2_published_at: string | null
    max_week_start: string | null
  }
  interface ComplianceData { week1: string; week2: string; stores: ComplianceStore[] }
  const [compliance, setCompliance] = useState<ComplianceData | null>(null)
  const [complianceLoading, setComplianceLoading] = useState(false)

  // Swap request state (employee only)
  const [swapSourceShift, setSwapSourceShift] = useState<Shift | null>(null)
  const [peerShifts, setPeerShifts] = useState<Shift[]>([])
  const [peerShiftsLoading, setPeerShiftsLoading] = useState(false)
  const [selectedPeerShiftId, setSelectedPeerShiftId] = useState('')
  const [swapNote, setSwapNote] = useState('')
  const [swapSubmitting, setSwapSubmitting] = useState(false)
  const [swapError, setSwapError] = useState('')

  // Computed week
  const monday = (() => {
    const base = currentWeekStart()
    base.setDate(base.getDate() + weekOffset * 7)
    return base
  })()
  const days = weekDays(monday)
  const weekStart = toDateStr(monday)
  const weekLabel = formatWeekRange(monday)

  const isEmployee = session?.role === 'employee'
  const canEdit = !!session && !isEmployee
  const canUnpublish = session?.role === 'ops_manager' || session?.role === 'owner' || session?.role === 'sales_director' || session?.role === 'developer' || session?.role === 'manager'
  const scheduleIsLocked = false

  // Scheduling window: max 3 weeks ahead for managers
  const MAX_OFFSET = session?.role === 'manager' ? 3 : 6
  const requiredWeek = (() => {
    const d = currentWeekStart()
    d.setDate(d.getDate() + 14)
    return toDateStr(d)
  })()
  const isRequiredWeek = weekStart === requiredWeek && session?.role === 'manager'

  // Load session + stores + employees once
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
  }, [])

  useEffect(() => {
    if (!session || isEmployee) return
    Promise.all([
      fetch('/api/dm-store-locations').then(r => r.json()).catch(() => ({})),
      fetch('/api/team/users').then(r => r.json()).catch(() => ({})),
    ]).then(([locs, team]) => {
      const storeList: Store[] = locs.locations ?? []
      setStores(storeList)
      if (storeList.length > 0 && !selectedStore) {
        setSelectedStore(storeList[0].id)
      }
      setEmployees(
        (team.users ?? []).filter((u: Employee) => u.role === 'employee' || u.role === 'manager')
      )
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const validateFlags = useCallback(async () => {
    if (!selectedStore || !weekStart || isEmployee) return
    setValidateLoading(true)
    try {
      const res = await fetch(`/api/schedule/validate?storeId=${selectedStore}&weekStart=${weekStart}`)
      if (res.ok) {
        const data = await res.json()
        setScheduleFlags(data.flags ?? [])
      }
    } catch {}
    setValidateLoading(false)
  }, [selectedStore, weekStart, isEmployee])

  const loadShifts = useCallback(async () => {
    if (!session) return
    setLoading(true)
    const params = new URLSearchParams({ weekStart })
    if (!isEmployee) {
      if (view === 'employee') {
        params.set('employeeView', 'true')
      } else if (selectedStore) {
        params.set('storeId', selectedStore)
      }
    }
    const res = await fetch(`/api/staff-schedule?${params}`)
    if (res.ok) {
      const data = await res.json()
      setShifts(data.shifts ?? [])
      setIsPublished(data.isPublished ?? false)
    }
    setLoading(false)
  }, [session, weekStart, selectedStore, isEmployee, view])

  useEffect(() => {
    if (!session) return
    if (!isEmployee && !selectedStore && view !== 'employee') { setLoading(false); return }
    loadShifts()
  }, [loadShifts, session, isEmployee, selectedStore, view])

  useEffect(() => {
    if (selectedStore && weekStart && !isEmployee) validateFlags()
  }, [validateFlags, selectedStore, weekStart, isEmployee])

  useEffect(() => {
    if (!session || isEmployee || pageTab !== 'dashboard') return
    setComplianceLoading(true)
    fetch('/api/schedule/compliance')
      .then(r => r.json())
      .then(d => { if (d.stores) setCompliance(d) })
      .finally(() => setComplianceLoading(false))
  }, [session, isEmployee, pageTab])

  function openAdd(shiftDate: string, employeeId = '') {
    setEditingShift(null)
    setModalError('')
    setForm({
      employeeId,
      storeId: view === 'employee' ? '' : selectedStore,
      shiftDate,
      startTime: '09:45',
      endTime: '19:00',
      roleNote: '',
      breakMinutes: 0,
      isOnCall: false,
      isDmShift: false,
      selectedDays: [shiftDate],
    })
    setModal('add')
  }

  function openEdit(shift: Shift) {
    setEditingShift(shift)
    setModalError('')
    setForm({
      employeeId: shift.employee_id ?? '',
      storeId: shift.store_location_id,
      shiftDate: shift.shift_date,
      startTime: shift.start_time.slice(0, 5),
      endTime: shift.end_time.slice(0, 5),
      roleNote: shift.role_note ?? '',
      breakMinutes: shift.break_minutes ?? 0,
      isOnCall: shift.is_on_call ?? false,
      isDmShift: shift.is_dm_shift ?? false,
      selectedDays: [],
    })
    setModal('edit')
  }

  async function saveShift() {
    setModalError('')
    if (!form.employeeId) { setModalError('Please select an employee.'); return }
    if (modal === 'add' && form.selectedDays.length === 0) { setModalError('Please select at least one day.'); return }
    if (modal === 'edit' && !form.shiftDate) { setModalError('Please select a date.'); return }
    if (!form.startTime || !form.endTime) { setModalError('Please set start and end times.'); return }
    if (view === 'employee' && modal !== 'edit' && !form.storeId) {
      setModalError('Please select a store.')
      return
    }
    setSaving(true)
    try {
      const storeIdToUse = form.storeId || selectedStore

      if (modal === 'edit' && editingShift) {
        const payload = { shiftId: editingShift.id, employeeId: form.employeeId, shiftDate: form.shiftDate, startTime: form.startTime, endTime: form.endTime, roleNote: form.roleNote || null, breakMinutes: form.breakMinutes, isOnCall: form.isOnCall, isDmShift: form.isDmShift }
        const res = await fetch('/api/staff-schedule', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          setModalError(d.error ?? `Save failed (${res.status}). Please try again.`)
          return
        }
      } else {
        // Multi-day add: POST one shift per selected day
        const errors: string[] = []
        for (const day of form.selectedDays) {
          const payload = { storeId: storeIdToUse, employeeId: form.employeeId, shiftDate: day, startTime: form.startTime, endTime: form.endTime, roleNote: form.roleNote || null, breakMinutes: form.breakMinutes, isOnCall: form.isOnCall, isDmShift: form.isDmShift }
          const res = await fetch('/api/staff-schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!res.ok) {
            const d = await res.json().catch(() => ({}))
            const label = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            errors.push(`${label}: ${d.error ?? 'Save failed'}`)
          }
        }
        if (errors.length > 0) {
          setModalError(errors.join(' · '))
          await loadShifts()
          validateFlags()
          return
        }
      }

      setModal(null)
      await loadShifts()
      validateFlags()
    } catch (err) {
      console.error('[saveShift] caught:', err)
      setModalError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteShift() {
    if (!editingShift) return
    setDeleting(true)
    try {
      const res = await fetch('/api/staff-schedule', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftId: editingShift.id }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.error ?? 'Failed to delete shift.')
        return
      }
      setModal(null)
      await loadShifts()
      validateFlags()
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  async function publishWeek(force = false) {
    if (scheduleFlags.length > 0 && !force && !publishWithFlags) {
      setPublishWithFlags(true)
      return
    }
    setPublishWithFlags(false)
    setPublishing(true)
    try {
      const res = await fetch('/api/staff-schedule/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: selectedStore, weekStart }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.error ?? 'Failed to publish schedule.')
        return
      }
      setIsPublished(true)
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setPublishing(false)
    }
  }

  async function unpublishWeek() {
    setPublishing(true)
    try {
      const res = await fetch('/api/staff-schedule/publish', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: selectedStore, weekStart }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.error ?? 'Failed to unpublish schedule.')
        return
      }
      setIsPublished(false)
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setPublishing(false)
    }
  }

  async function copyLastWeek() {
    if (!selectedStore || !weekStart) return
    setCopying(true)
    try {
      const res = await fetch('/api/staff-schedule/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: selectedStore, targetWeekStart: weekStart }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(d.error ?? 'Failed to copy schedule.')
        return
      }
      await loadShifts()
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setCopying(false)
    }
  }

  const unassignedCount = shifts.filter(s => !s.employee_id).length

  async function openSwapModal(shift: Shift) {
    setSwapSourceShift(shift)
    setSelectedPeerShiftId('')
    setSwapNote('')
    setSwapError('')
    setPeerShiftsLoading(true)
    // Get the Monday of the week containing this shift
    const d = new Date(shift.shift_date + 'T12:00:00')
    const day = d.getDay()
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
    const weekMonday = d.toISOString().split('T')[0]
    const res = await fetch(`/api/shift-swaps?peerShifts=true&weekStart=${weekMonday}`)
    if (res.ok) {
      const data = await res.json()
      setPeerShifts(data.shifts ?? [])
    }
    setPeerShiftsLoading(false)
  }

  async function submitSwapRequest() {
    if (!swapSourceShift || !selectedPeerShiftId) {
      setSwapError('Please select a coworker shift to swap with.')
      return
    }
    setSwapSubmitting(true)
    setSwapError('')
    try {
      const res = await fetch('/api/shift-swaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterShiftId: swapSourceShift.id,
          targetShiftId: selectedPeerShiftId,
          note: swapNote.trim() || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setSwapError(d.error ?? 'Failed to send swap request.')
        return
      }
      setSwapSourceShift(null)
    } catch {
      setSwapError('Network error. Please try again.')
    } finally {
      setSwapSubmitting(false)
    }
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  // ── Employee read-only view ──────────────────────────────────────────────
  if (isEmployee) {
    return (
      <div className="min-h-screen bg-gray-950 pb-20 pt-14">
        <NavBar role={session.role} fullName={session.fullName} />
        <div className="px-4 pt-6 max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-xl font-bold text-white">My Schedule</h1>
              <a href="/shift-swaps" className="text-xs text-violet-400 hover:text-violet-300 font-medium">Swap Requests →</a>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setWeekOffset(w => w - 1)}
                className="p-2 text-gray-400 hover:text-white transition-colors text-lg"
              >‹</button>
              <span className="text-xs text-gray-400 min-w-[110px] text-center">{weekLabel}</span>
              <button
                onClick={() => setWeekOffset(w => w + 1)}
                className="p-2 text-gray-400 hover:text-white transition-colors text-lg"
              >›</button>
            </div>
          </div>

          {loading ? (
            <div className="text-center text-gray-500 py-12">Loading…</div>
          ) : (
            <div className="space-y-2">
              {days.map((day, i) => {
                const dateStr = toDateStr(day)
                const dayShifts = shifts.filter(s => s.shift_date === dateStr)
                const isToday = dateStr === toDateStr(new Date())
                const isDayOff = dayShifts.length === 0
                return (
                  <div key={i} className={`border rounded-2xl overflow-hidden ${isToday ? 'border-violet-600/50' : 'border-gray-800'} ${isDayOff ? 'bg-gray-900/40' : 'bg-gray-900'}`}>
                    <div className={`px-4 py-2.5 flex items-center justify-between border-b ${isToday ? 'bg-violet-900/20 border-violet-800/40' : 'bg-gray-800/40 border-gray-800'}`}>
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-semibold ${isToday ? 'text-violet-300' : 'text-white'}`}>{DAY_NAMES[i]}</p>
                        {isToday && <span className="text-[10px] font-bold text-violet-400 bg-violet-900/40 border border-violet-700/40 px-1.5 py-0.5 rounded-full">TODAY</span>}
                      </div>
                      <p className="text-xs text-gray-500">{fmtDate(day)}</p>
                    </div>
                    {isDayOff ? (
                      <div className="px-4 py-3 flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                        </svg>
                        <p className="text-sm text-gray-600 italic">Day Off</p>
                      </div>
                    ) : (
                      dayShifts.map(shift => (
                        <div key={shift.id} className={`px-4 py-3 border-b border-gray-800/50 last:border-0 ${shift.is_on_call ? 'bg-amber-950/20' : ''}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className={`text-sm font-medium ${shift.is_on_call ? 'text-amber-300' : 'text-white'}`}>
                                  {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
                                </p>
                                {shift.is_on_call && (
                                  <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full">ON CALL</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">{shift.store_address}</p>
                              {shift.role_note && (
                                <p className="text-xs text-violet-400 mt-0.5">{shift.role_note}</p>
                              )}
                              {shift.is_on_call && (
                                <p className="text-[10px] text-amber-600 mt-0.5">Available if needed — not counted as scheduled hours</p>
                              )}
                            </div>
                            {!shift.is_on_call && shift.shift_date >= new Date().toISOString().split('T')[0] && (
                              <button
                                onClick={() => openSwapModal(shift)}
                                className="shrink-0 text-xs text-violet-400 hover:text-violet-300 border border-violet-800/50 hover:border-violet-600 px-2 py-1 rounded-lg transition-colors"
                              >
                                ↔ Swap
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Swap Request Modal ── */}
        {swapSourceShift && (
          <div
            className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setSwapSourceShift(null)}
          >
            <div
              className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6 max-h-[85vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-white mb-1">Request Shift Swap</h2>
              <p className="text-xs text-gray-500 mb-4">Select a coworker shift to swap with yours</p>

              {/* Your shift */}
              <div className="bg-gray-800 rounded-xl px-4 py-3 mb-4">
                <p className="text-[10px] text-gray-500 mb-1">YOUR SHIFT</p>
                <p className="text-sm font-semibold text-white">
                  {new Date(swapSourceShift.shift_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </p>
                <p className="text-xs text-gray-300 mt-0.5">
                  {fmtTime(swapSourceShift.start_time)} – {fmtTime(swapSourceShift.end_time)}
                </p>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{swapSourceShift.store_address}</p>
              </div>

              {/* Peer shifts */}
              <p className="text-xs font-semibold text-gray-400 mb-2">SWAP WITH</p>
              {peerShiftsLoading ? (
                <div className="text-center text-gray-600 py-6 text-sm">Loading coworker shifts…</div>
              ) : peerShifts.length === 0 ? (
                <div className="text-center text-gray-600 py-6 text-sm">No published shifts from coworkers this week.</div>
              ) : (
                <div className="space-y-2 mb-4">
                  {peerShifts.map(ps => (
                    <button
                      key={ps.id}
                      onClick={() => setSelectedPeerShiftId(ps.id === selectedPeerShiftId ? '' : ps.id)}
                      className={`w-full text-left rounded-xl px-4 py-3 border transition-colors ${
                        selectedPeerShiftId === ps.id
                          ? 'bg-violet-600/20 border-violet-600'
                          : 'bg-gray-800 border-gray-700 hover:border-gray-500'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-gray-300">{ps.employee_name}</p>
                          <p className="text-sm text-white mt-0.5">
                            {new Date(ps.shift_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </p>
                          <p className="text-xs text-gray-400">{fmtTime(ps.start_time)} – {fmtTime(ps.end_time)}</p>
                        </div>
                        {selectedPeerShiftId === ps.id && (
                          <span className="text-violet-400 text-lg">✓</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Note */}
              <div className="mb-4">
                <label className="block text-xs text-gray-400 mb-1.5">Note to coworker (optional)</label>
                <textarea
                  value={swapNote}
                  onChange={e => setSwapNote(e.target.value)}
                  rows={2}
                  placeholder="Explain why you need the swap…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none"
                />
              </div>

              {swapError && (
                <div className="rounded-xl bg-red-900/30 border border-red-600/40 px-4 py-3 text-sm text-red-400 mb-4">
                  {swapError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setSwapSourceShift(null)}
                  className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={submitSwapRequest}
                  disabled={swapSubmitting || !selectedPeerShiftId}
                  className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-semibold text-sm transition-colors"
                >
                  {swapSubmitting ? 'Sending…' : 'Send Request'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Manager+ view ────────────────────────────────────────────────────────
  const currentStore = stores.find(s => s.id === selectedStore)

  // Compliance helpers
  function fmtWeekLabel(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00Z')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  function throughDate(maxWeekStart: string | null): string {
    if (!maxWeekStart) return '—'
    const d = new Date(maxWeekStart + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + 6)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  }

  const isOpsPlus = session.role === 'ops_manager' || session.role === 'owner' ||
    session.role === 'sales_director' || session.role === 'developer'

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      {/* Tab bar */}
      <div className="flex border-b border-gray-800 bg-gray-950 sticky top-14 z-30">
        {(['dashboard', 'schedule'] as const).map(t => (
          <button
            key={t}
            onClick={() => setPageTab(t)}
            className={`px-5 py-3 text-sm font-semibold transition-colors border-b-2 capitalize ${
              pageTab === t
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {t === 'dashboard' ? 'Dashboard' : 'Schedule'}
          </button>
        ))}
      </div>

      {/* ── DASHBOARD TAB ── */}
      {pageTab === 'dashboard' && (
        <div className="px-4 pt-5 max-w-2xl mx-auto pb-10">
          {complianceLoading || !compliance ? (
            <div className="text-center text-gray-500 py-16 text-sm">Loading…</div>
          ) : (() => {
            const stores = compliance.stores
            const compliant = stores.filter(s => s.week1_published_at && s.week2_published_at).length
            const partial   = stores.filter(s => (s.week1_published_at || s.week2_published_at) && !(s.week1_published_at && s.week2_published_at)).length
            const none      = stores.filter(s => !s.week1_published_at && !s.week2_published_at).length

            // Group by DM for ops+
            const byDm: Record<string, { dmName: string; stores: typeof stores }> = {}
            for (const s of stores) {
              const key = s.dm_name ?? 'Unassigned'
              if (!byDm[key]) byDm[key] = { dmName: key, stores: [] }
              byDm[key].stores.push(s)
            }

            return (
              <>
                {/* Summary pills */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  <div className="bg-green-950/40 border border-green-800/50 rounded-2xl px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-green-400">{compliant}</p>
                    <p className="text-xs text-green-600 mt-0.5">Compliant</p>
                  </div>
                  <div className="bg-amber-950/40 border border-amber-800/50 rounded-2xl px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-amber-400">{partial}</p>
                    <p className="text-xs text-amber-600 mt-0.5">Partial</p>
                  </div>
                  <div className="bg-red-950/40 border border-red-800/50 rounded-2xl px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-red-400">{none}</p>
                    <p className="text-xs text-red-600 mt-0.5">Missing</p>
                  </div>
                </div>

                {/* Week header labels */}
                <div className="grid grid-cols-[1fr_80px_80px_90px] gap-2 px-2 mb-2">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Store</p>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center">
                    Wk of {fmtWeekLabel(compliance.week1)}
                  </p>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center">
                    Wk of {fmtWeekLabel(compliance.week2)}
                  </p>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider text-center">Through</p>
                </div>

                {/* Store rows */}
                {isOpsPlus ? (
                  // Group by DM
                  <div className="space-y-4">
                    {Object.entries(byDm).sort(([a], [b]) => a.localeCompare(b)).map(([, { dmName, stores: dmStores }]) => (
                      <div key={dmName}>
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 px-1">{dmName}</p>
                        <div className="space-y-1.5">
                          {dmStores.map(s => (
                            <ComplianceRow key={s.store_id} store={s} throughDate={throughDate} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  // DM sees flat list
                  <div className="space-y-1.5">
                    {stores.map(s => (
                      <ComplianceRow key={s.store_id} store={s} throughDate={throughDate} />
                    ))}
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}

      {pageTab === 'schedule' && (
      <>
      <div className="px-4 pt-6 max-w-2xl mx-auto">
        {/* Title row */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-white">Staff Schedule</h1>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex rounded-xl overflow-hidden border border-gray-800">
              <button
                onClick={() => setView('list')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'list' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                List
              </button>
              <button
                onClick={() => setView('gantt')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'gantt' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                Gantt
              </button>
              <button
                onClick={() => setView('employee')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'employee' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                By Employee
              </button>
            </div>
          </div>
        </div>

        {/* Deadline banner — managers only */}
        {session?.role === 'manager' && (
          <div className="bg-amber-950/50 border border-amber-700/50 rounded-xl px-4 py-2.5 mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-amber-400">Schedule Due Every Monday</p>
              <p className="text-[11px] text-amber-600 mt-0.5">
                Week of {new Date(requiredWeek + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} must be entered by end of today each Monday
              </p>
            </div>
            <button
              onClick={() => setWeekOffset(2)}
              className="shrink-0 ml-3 text-[11px] text-amber-400 border border-amber-700/60 px-2.5 py-1 rounded-lg hover:bg-amber-900/40 transition-colors"
            >
              View →
            </button>
          </div>
        )}

        {/* Week nav */}
        <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 mb-3">
          <button onClick={() => setWeekOffset(w => w - 1)} className="text-gray-400 hover:text-white text-xl px-1 transition-colors">‹</button>
          <div className="text-center">
            <p className="text-sm font-semibold text-white">{weekLabel}</p>
            {weekOffset === 0 && <p className="text-[10px] text-violet-400">Current Week</p>}
            {weekOffset === 1 && <p className="text-[10px] text-gray-500">Next Week</p>}
            {isRequiredWeek && <p className="text-[10px] text-amber-400 font-semibold">⚠ Due this Monday</p>}
            {weekOffset === 3 && <p className="text-[10px] text-gray-500">3 Weeks Out</p>}
          </div>
          <button
            onClick={() => setWeekOffset(w => Math.min(w + 1, MAX_OFFSET))}
            disabled={weekOffset >= MAX_OFFSET}
            className="text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-xl px-1 transition-colors"
          >›</button>
        </div>

        {/* Store selector — hidden in employee view */}
        {view !== 'employee' && stores.length > 1 ? (
          <select
            value={selectedStore}
            onChange={e => setSelectedStore(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 text-sm text-white mb-3 focus:outline-none focus:border-violet-500"
          >
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.address}</option>
            ))}
          </select>
        ) : view !== 'employee' && currentStore ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 mb-3">
            <p className="text-xs text-gray-500">Store</p>
            <p className="text-sm text-white truncate">{currentStore.address}</p>
          </div>
        ) : null}

        {/* Hours summary — store view (list / gantt) */}
        {selectedStore && view !== 'employee' && !loading && shifts.length > 0 && (() => {
          const scheduled = shifts.filter(s => !s.is_on_call && !s.is_dm_shift)
          const totalHrs = scheduled.reduce((sum, s) => {
            const [sh, sm] = s.start_time.split(':').map(Number)
            const [eh, em] = s.end_time.split(':').map(Number)
            return sum + Math.max(0, (eh + em / 60) - (sh + sm / 60) - (s.break_minutes ?? 0) / 60)
          }, 0)
          const fmtHrs = totalHrs % 1 === 0 ? `${totalHrs}` : totalHrs.toFixed(1)
          const uniqueEmps = new Set(scheduled.filter(s => s.employee_id).map(s => s.employee_id)).size
          return (
            <div className="flex gap-2 mb-3">
              <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-white">{fmtHrs}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">Hrs Scheduled</p>
              </div>
              <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-white">{scheduled.length}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">Shifts</p>
              </div>
              <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-white">{uniqueEmps}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">Employees</p>
              </div>
            </div>
          )
        })()}

        {/* Schedule validation flags panel */}
        {selectedStore && view !== 'employee' && !isEmployee && (
          <>
            {scheduleFlags.length > 0 && (
              <div className="mb-3 bg-amber-950/30 border border-amber-700/50 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left"
                  onClick={() => setShowFlagsPanel(p => !p)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400 font-semibold text-xs">⚠ Schedule Flags</span>
                    <span className="bg-amber-500 text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full">{scheduleFlags.length}</span>
                    {validateLoading && <span className="text-amber-600 text-[10px]">Checking…</span>}
                  </div>
                  <span className="text-amber-600 text-xs">{showFlagsPanel ? '▲' : '▼'}</span>
                </button>
                {showFlagsPanel && (
                  <div className="px-4 pb-3 space-y-1.5 border-t border-amber-800/40 pt-2.5">
                    {scheduleFlags.map((f, i) => {
                      const icon = f.type === 'no_opener' ? '🔓' : f.type === 'no_closer' ? '🔒' : f.type === 'gap' ? '⏱' : f.type === 'overlap' ? '👥' : '⏰'
                      return (
                        <div key={i} className="flex items-start gap-2 text-xs text-amber-300">
                          <span className="shrink-0 mt-0.5">{icon}</span>
                          <span>{f.detail}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
            {scheduleFlags.length === 0 && !validateLoading && shifts.length > 0 && (
              <div className="mb-3 bg-green-950/30 border border-green-800/40 rounded-xl px-4 py-2 flex items-center gap-2">
                <span className="text-green-400 text-xs font-semibold">✓ No schedule issues found</span>
              </div>
            )}
          </>
        )}

        {/* Publish-with-flags confirmation */}
        {publishWithFlags && (
          <div className="mb-3 bg-red-950/40 border border-red-700/60 rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-white mb-1">Publish with {scheduleFlags.length} flag{scheduleFlags.length > 1 ? 's' : ''}?</p>
            <p className="text-xs text-red-300 mb-3">Flags will be saved to your team flags for review. You can still resolve them after publishing.</p>
            <div className="flex gap-2">
              <button onClick={() => publishWeek(true)} disabled={publishing}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-semibold text-xs py-2 rounded-lg transition-colors">
                {publishing ? 'Publishing…' : 'Publish Anyway'}
              </button>
              <button onClick={() => setPublishWithFlags(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold py-2 rounded-lg transition-colors">
                Go Back
              </button>
            </div>
          </div>
        )}

        {/* Publish bar — only in list/gantt with a selected store */}
        {selectedStore && view !== 'employee' && (
          <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 mb-5">
            <div>
              <p className="text-xs text-gray-500">Status</p>
              <p className={`text-sm font-semibold ${isPublished ? 'text-green-400' : unassignedCount > 0 ? 'text-orange-400' : 'text-yellow-500'}`}>
                {isPublished
                  ? '✓ Published — employees can see this'
                  : unassignedCount > 0
                  ? `⚠ ${unassignedCount} shift${unassignedCount > 1 ? 's' : ''} need employees assigned`
                  : 'Draft — not visible to employees'}
              </p>
            </div>
            <div className="flex gap-2">
              {isPublished && canUnpublish && (
                <button
                  onClick={unpublishWeek}
                  disabled={publishing}
                  className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  {publishing ? '…' : 'Unpublish'}
                </button>
              )}
              {!isPublished && shifts.length === 0 && (
                <button
                  onClick={copyLastWeek}
                  disabled={copying}
                  className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  {copying ? 'Copying…' : '⎘ Copy Last Week'}
                </button>
              )}
              {!isPublished && (
                <button
                  onClick={() => publishWeek()}
                  disabled={publishing || shifts.length === 0 || unassignedCount > 0}
                  className={`text-xs disabled:opacity-40 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                    unassignedCount > 0 ? 'bg-gray-600' : scheduleFlags.length > 0 ? 'bg-amber-600 hover:bg-amber-500' : 'bg-green-600 hover:bg-green-500'
                  }`}
                >
                  {publishing ? 'Publishing…' : unassignedCount > 0 ? `Assign ${unassignedCount} first` : scheduleFlags.length > 0 ? `Publish (${scheduleFlags.length} flags)` : 'Publish Week'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* No stores state */}
        {!selectedStore && view !== 'employee' && (
          <div className="text-center text-gray-500 py-16">
            <p className="text-sm">No stores assigned to you yet.</p>
            <p className="text-xs mt-1">Contact your Owner to get stores assigned.</p>
          </div>
        )}

        {/* Content */}
        {(selectedStore || view === 'employee') && loading ? (
          <div className="text-center text-gray-500 py-12">Loading…</div>
        ) : view === 'employee' ? (
          // ── Employee View ──
          <EmployeeView
            days={days}
            shifts={shifts}
            employees={employees.filter(e => e.role === 'employee')}
            stores={stores}
            canEdit={canEdit && !scheduleIsLocked}
            onAdd={(dateStr, employeeId) => openAdd(dateStr, employeeId)}
            onEdit={openEdit}
          />
        ) : selectedStore && view === 'list' ? (
          // ── List View ──
          <div className="space-y-3">
            {days.map((day, i) => {
              const dateStr = toDateStr(day)
              const dayShifts = shifts.filter(s => s.shift_date === dateStr)
              return (
                <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-800/40 border-b border-gray-800">
                    <div>
                      <p className="text-sm font-semibold text-white">{DAY_NAMES[i]}</p>
                      <p className="text-xs text-gray-500">{fmtDate(day)}</p>
                    </div>
                    {!scheduleIsLocked && (
                      <button
                        onClick={() => openAdd(dateStr)}
                        className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
                      >
                        + Add Shift
                      </button>
                    )}
                  </div>

                  {dayShifts.length === 0 ? (
                    <div className="px-4 py-4 text-xs text-gray-700 text-center">No shifts</div>
                  ) : (
                    <div className="divide-y divide-gray-800/60">
                      {dayShifts.map(shift => (
                        <div key={shift.id} className={`flex items-center justify-between px-4 py-3 gap-3 ${!shift.employee_id ? 'bg-orange-950/20' : shift.is_dm_shift ? 'bg-blue-950/20' : ''}`}>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {shift.employee_name ? (
                                <p className={`text-sm font-medium truncate ${shift.is_dm_shift ? 'text-blue-300' : 'text-white'}`}>{shift.employee_name}</p>
                              ) : (
                                <p className="text-sm font-semibold text-orange-400">⚠ Unassigned</p>
                              )}
                              {shift.is_dm_shift && (
                                <span className="text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded-full shrink-0">DM COVERAGE</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
                              {shift.break_minutes > 0 && <span className="text-gray-600 ml-1">· {shift.break_minutes}m break</span>}
                            </p>
                            {shift.role_note && (
                              <p className="text-xs text-violet-400 mt-0.5">{shift.role_note}</p>
                            )}
                          </div>
                          {!scheduleIsLocked && (
                            <button
                              onClick={() => openEdit(shift)}
                              className={`shrink-0 text-xs border px-2.5 py-1 rounded-lg transition-colors ${
                                !shift.employee_id
                                  ? 'text-orange-400 border-orange-700/60 hover:text-white hover:border-orange-500'
                                  : 'text-gray-500 hover:text-white border-gray-700 hover:border-gray-500'
                              }`}
                            >
                              {shift.employee_id ? 'Edit' : 'Assign'}
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
        ) : selectedStore && view === 'gantt' ? (
          // ── Gantt View ──
          <GanttView
            days={days}
            shifts={shifts}
            ganttDay={ganttDay}
            setGanttDay={setGanttDay}
            onEdit={scheduleIsLocked ? undefined : openEdit}
            onAdd={scheduleIsLocked ? undefined : (dateStr) => openAdd(dateStr)}
          />
        ) : null}
      </div>

      {/* ── Add/Edit Modal ── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6 max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-white mb-5">
              {modal === 'edit' && !editingShift?.employee_id ? 'Assign Employee' : modal === 'edit' ? 'Edit Shift' : 'Add Shift'}
            </h2>

            <div className="space-y-4">
              {/* Store — only shown in employee view for new shifts */}
              {view === 'employee' && modal === 'add' && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Store</label>
                  <select
                    value={form.storeId}
                    onChange={e => setForm(f => ({ ...f, storeId: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  >
                    <option value="">Select store…</option>
                    {stores.map(s => (
                      <option key={s.id} value={s.id}>{s.address}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Employee */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Employee</label>
                {form.isDmShift ? (
                  <div className="w-full bg-blue-900/20 border border-blue-700/50 rounded-xl px-4 py-3 text-sm text-blue-300">
                    {session.fullName} <span className="text-blue-600">(you — DM coverage)</span>
                  </div>
                ) : (
                  <select
                    value={form.employeeId}
                    onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  >
                    <option value="">Select employee…</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Store (read-only label) when editing in employee view */}
              {view === 'employee' && modal === 'edit' && editingShift && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Store</label>
                  <div className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-300 truncate">
                    {editingShift.store_address}
                  </div>
                </div>
              )}

              {/* Date / Day picker */}
              {modal === 'edit' ? (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Date</label>
                  <input
                    type="date"
                    value={form.shiftDate}
                    min={toDateStr(days[0])}
                    max={toDateStr(days[6])}
                    onChange={e => setForm(f => ({ ...f, shiftDate: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">
                    Day{form.selectedDays.length > 1 ? 's' : ''}
                    <span className="text-gray-600 font-normal ml-1">— select multiple</span>
                  </label>
                  <div className="grid grid-cols-7 gap-1">
                    {days.map((day, i) => {
                      const dateStr = toDateStr(day)
                      const isSelected = form.selectedDays.includes(dateStr)
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setForm(f => ({
                            ...f,
                            selectedDays: isSelected
                              ? f.selectedDays.filter(d => d !== dateStr)
                              : [...f.selectedDays, dateStr],
                          }))}
                          className={`flex flex-col items-center py-2.5 rounded-xl text-xs font-medium transition-colors border ${
                            isSelected
                              ? 'bg-violet-600 border-violet-500 text-white'
                              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
                          }`}
                        >
                          <span>{DAY_SHORT[i]}</span>
                          <span className={`text-[10px] mt-0.5 ${isSelected ? 'opacity-80' : 'opacity-50'}`}>{day.getDate()}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Times */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Start Time</label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">End Time</label>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              {/* Role note */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Role / Note (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Opener, Closer, Register 1"
                  value={form.roleNote}
                  onChange={e => setForm(f => ({ ...f, roleNote: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              {/* Break — hidden for on-call shifts */}
              {!form.isOnCall && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Break</label>
                  <div className="flex gap-2">
                    {([0, 30, 60] as const).map(mins => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, breakMinutes: mins }))}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors border ${
                          form.breakMinutes === mins
                            ? 'bg-violet-600 border-violet-500 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                        }`}
                      >
                        {mins === 0 ? 'None' : `${mins} min`}
                      </button>
                    ))}
                  </div>
                  {form.breakMinutes > 0 && (
                    <p className="text-xs text-gray-500 mt-1">Break deducted from total hours for OT check.</p>
                  )}
                </div>
              )}

              {/* On Call toggle */}
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, isOnCall: !f.isOnCall, breakMinutes: !f.isOnCall ? 0 : f.breakMinutes }))}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                  form.isOnCall
                    ? 'bg-amber-900/30 border-amber-600/50 text-amber-300'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  <div className="text-left">
                    <p className="text-sm font-semibold">On Call</p>
                    <p className="text-xs opacity-70">Won&apos;t count toward scheduled hours</p>
                  </div>
                </div>
                <div className={`w-10 h-5 rounded-full transition-colors relative ${form.isOnCall ? 'bg-amber-500' : 'bg-gray-600'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.isOnCall ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </button>

              {/* DM Coverage toggle — managers only */}
              {session.role === 'manager' && (
                <button
                  type="button"
                  onClick={() => setForm(f => ({
                    ...f,
                    isDmShift: !f.isDmShift,
                    employeeId: !f.isDmShift ? session.id : f.employeeId,
                    isOnCall: false,
                    breakMinutes: 0,
                  }))}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                    form.isDmShift
                      ? 'bg-blue-900/30 border-blue-600/50 text-blue-300'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <div className="text-left">
                      <p className="text-sm font-semibold">DM Coverage Shift</p>
                      <p className="text-xs opacity-70">Assigns shift to you — won&apos;t count toward OT</p>
                    </div>
                  </div>
                  <div className={`w-10 h-5 rounded-full transition-colors relative ${form.isDmShift ? 'bg-blue-500' : 'bg-gray-600'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.isDmShift ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </div>
                </button>
              )}

              {modalError && (
                <div className="rounded-xl bg-red-900/30 border border-red-600/40 px-4 py-3 text-sm text-red-400">
                  {modalError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                {modal === 'edit' && (
                  <button
                    onClick={deleteShift}
                    disabled={deleting || saving}
                    className="px-4 py-3 rounded-xl bg-red-600/20 hover:bg-red-600/40 disabled:opacity-50 text-red-400 font-medium text-sm transition-colors border border-red-600/30"
                  >
                    {deleting ? '…' : 'Delete'}
                  </button>
                )}
                <button
                  onClick={() => setModal(null)}
                  className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={saveShift}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                >
                  {saving
                    ? (modal === 'add' && form.selectedDays.length > 1 ? `Adding ${form.selectedDays.length} shifts…` : 'Saving…')
                    : modal === 'edit'
                    ? 'Save Changes'
                    : form.selectedDays.length > 1
                    ? `Add ${form.selectedDays.length} Shifts`
                    : 'Add Shift'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </> )} {/* end pageTab === 'schedule' */}
    </div>
  )
}

// ── Employee View ─────────────────────────────────────────────────────────────

function EmployeeView({
  days,
  shifts,
  employees,
  stores,
  canEdit,
  onAdd,
  onEdit,
}: {
  days: Date[]
  shifts: Shift[]
  employees: Employee[]
  stores: Store[]
  canEdit: boolean
  onAdd: (dateStr: string, employeeId: string) => void
  onEdit: (shift: Shift) => void
}) {
  function abbrevStore(address: string): string {
    return address.split(',')[0].trim()
  }

  function shiftHours(start: string, end: string, breakMins = 0): number {
    const [sh, sm] = start.split(':').map(Number)
    const [eh, em] = end.split(':').map(Number)
    return Math.max(0, (eh + em / 60) - (sh + sm / 60) - breakMins / 60)
  }

  function empTotalHours(empId: string): string {
    const total = shifts
      .filter(s => s.employee_id === empId && !s.is_on_call && !s.is_dm_shift)
      .reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time, s.break_minutes ?? 0), 0)
    return total === 0 ? '—' : `${Math.round(total * 10) / 10}h`
  }

  if (employees.length === 0) {
    return (
      <div className="text-center text-gray-500 py-12">
        <p className="text-sm">No employees assigned to you yet.</p>
      </div>
    )
  }

  const dayMap = new Map(days.map((d, i) => [d.toISOString().split('T')[0], i]))

  const totalWeekHrs = shifts
    .filter(s => !s.is_on_call && !s.is_dm_shift)
    .reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time, s.break_minutes ?? 0), 0)
  const fmtTotal = totalWeekHrs % 1 === 0 ? `${totalWeekHrs}` : totalWeekHrs.toFixed(1)
  const scheduledEmpCount = employees.filter(emp => shifts.some(s => s.employee_id === emp.id && !s.is_on_call)).length

  return (
    <div className="space-y-3">
      {totalWeekHrs > 0 && (
        <div className="flex gap-2">
          <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-center">
            <p className="text-lg font-bold text-white">{fmtTotal}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Total Hrs</p>
          </div>
          <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-center">
            <p className="text-lg font-bold text-white">{scheduledEmpCount}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Scheduled</p>
          </div>
          <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-center">
            <p className="text-lg font-bold text-white">{employees.length - scheduledEmpCount}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">No Shifts</p>
          </div>
        </div>
      )}
      {employees.map(emp => {
        const empShifts = shifts
          .filter(s => s.employee_id === emp.id)
          .sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.start_time.localeCompare(b.start_time))
        const totalLabel = empTotalHours(emp.id)

        return (
          <div key={emp.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            {/* Employee header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-800/40 border-b border-gray-800">
              <p className="text-sm font-bold text-white">{emp.full_name}</p>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${totalLabel === '—' ? 'text-gray-600' : 'text-green-400 bg-green-950/60 border border-green-800/50'}`}>
                  {totalLabel === '—' ? 'No shifts' : `${totalLabel}`}
                </span>
                {canEdit && (
                  <button
                    onClick={() => onAdd(days[0].toISOString().split('T')[0], emp.id)}
                    className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
                  >
                    + Add Shift
                  </button>
                )}
              </div>
            </div>

            {/* Shift list */}
            {empShifts.length === 0 ? (
              <div className="px-4 py-4 text-xs text-gray-700 text-center">No shifts scheduled this week</div>
            ) : (
              <div className="divide-y divide-gray-800/60">
                {empShifts.map(shift => {
                  const dayIdx = dayMap.get(shift.shift_date) ?? -1
                  return (
                    <div key={shift.id} className={`flex items-center justify-between px-4 py-3 gap-3 ${shift.is_on_call ? 'bg-amber-950/20' : ''}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-gray-400 w-8 flex-shrink-0">
                            {dayIdx >= 0 ? DAY_SHORT[dayIdx] : shift.shift_date.slice(5)}
                          </span>
                          <p className={`text-sm font-medium ${shift.is_on_call ? 'text-amber-300' : 'text-white'}`}>
                            {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
                          </p>
                          {shift.is_on_call ? (
                            <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full">ON CALL</span>
                          ) : shift.is_dm_shift ? (
                            <span className="text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded-full">DM COVERAGE</span>
                          ) : (
                            <span className="text-xs text-gray-600">
                              ({Math.round(shiftHours(shift.start_time, shift.end_time, shift.break_minutes ?? 0) * 10) / 10}h{shift.break_minutes > 0 ? ` · ${shift.break_minutes}m break` : ''})
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 ml-10 truncate">{abbrevStore(shift.store_address)}</p>
                        {shift.role_note && (
                          <p className="text-xs text-violet-400 mt-0.5 ml-10">{shift.role_note}</p>
                        )}
                      </div>
                      {canEdit && (
                        <button
                          onClick={() => onEdit(shift)}
                          className="shrink-0 text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-2.5 py-1 rounded-lg transition-colors"
                        >
                          Edit
                        </button>
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
  )
}

// ── Gantt Chart ──────────────────────────────────────────────────────────────

function GanttView({
  days,
  shifts,
  ganttDay,
  setGanttDay,
  onEdit,
  onAdd,
}: {
  days: Date[]
  shifts: Shift[]
  ganttDay: number
  setGanttDay: (d: number) => void
  onEdit?: (s: Shift) => void
  onAdd?: (dateStr: string) => void
}) {
  const day = days[ganttDay]
  const dateStr = day.toISOString().split('T')[0]
  const dayShifts = shifts.filter(s => s.shift_date === dateStr)

  // Unique employees for this day (null employee_id grouped as '__unassigned__')
  const empMap = new Map<string, string>()
  dayShifts.forEach(s => empMap.set(s.employee_id ?? '__unassigned__', s.employee_name ?? '⚠ Unassigned'))
  const empList = [...empMap.entries()]

  // Build hour labels
  const hourLabels: string[] = []
  for (let h = GANTT_START; h <= GANTT_END; h++) {
    if (h === 12) hourLabels.push('12PM')
    else if (h < 12) hourLabels.push(`${h}AM`)
    else hourLabels.push(`${h - 12}PM`)
  }

  return (
    <div>
      {/* Day selector */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {days.map((d, i) => (
          <button
            key={i}
            onClick={() => setGanttDay(i)}
            className={`shrink-0 flex flex-col items-center px-3 py-2 rounded-xl text-xs font-medium transition-colors min-w-[44px] ${
              ganttDay === i ? 'bg-violet-600 text-white' : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            <span>{DAY_SHORT[i]}</span>
            <span className={`text-[10px] mt-0.5 ${ganttDay === i ? 'opacity-80' : 'opacity-50'}`}>
              {d.getDate()}
            </span>
            {shifts.filter(s => s.shift_date === toDateStr(d)).length > 0 && (
              <span className={`w-1 h-1 rounded-full mt-0.5 ${ganttDay === i ? 'bg-white/60' : 'bg-violet-500'}`} />
            )}
          </button>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        {/* Day header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div>
            <p className="text-sm font-semibold text-white">{DAY_NAMES[ganttDay]}, {day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
            <p className="text-xs text-gray-500">{dayShifts.length} shift{dayShifts.length !== 1 ? 's' : ''}</p>
          </div>
          {onAdd && (
            <button
              onClick={() => onAdd(dateStr)}
              className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-colors"
            >
              + Add Shift
            </button>
          )}
        </div>

        {empList.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-600">
            No shifts scheduled
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[520px]">
              {/* Time axis */}
              <div className="flex pl-28 pr-3 pt-2 pb-1 border-b border-gray-800/60">
                {hourLabels.map((label, i) => (
                  <div key={i} className="flex-1 text-[9px] text-gray-700 text-left -ml-2 first:ml-0">
                    {label}
                  </div>
                ))}
              </div>

              {/* Employee rows */}
              {empList.map(([empId, empName]) => {
                const empShifts = dayShifts.filter(s => (s.employee_id ?? '__unassigned__') === empId)
                return (
                  <div key={empId} className="flex items-center border-b border-gray-800/40 last:border-0 py-2">
                    {/* Name */}
                    <div className="w-28 shrink-0 px-3">
                      <p className="text-xs text-gray-400 truncate">{empName}</p>
                    </div>
                    {/* Timeline */}
                    <div className="flex-1 relative h-8 pr-3">
                      {/* Grid lines */}
                      {hourLabels.map((_, i) => (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 border-l border-gray-800/50"
                          style={{ left: `${(i / GANTT_SPAN) * 100}%` }}
                        />
                      ))}
                      {/* Shift bars */}
                      {empShifts.map(shift => {
                        const start = Math.max(timeToHours(shift.start_time), GANTT_START)
                        const end = Math.min(timeToHours(shift.end_time), GANTT_END)
                        const left = ((start - GANTT_START) / GANTT_SPAN) * 100
                        const width = Math.max(((end - start) / GANTT_SPAN) * 100, 1)
                        return (
                          <button
                            key={shift.id}
                            onClick={() => onEdit?.(shift)}
                            disabled={!onEdit}
                            className="absolute top-1 bottom-1 bg-violet-600 hover:bg-violet-500 disabled:cursor-default rounded-md transition-colors flex items-center px-1.5 overflow-hidden"
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`${fmtTime(shift.start_time)} – ${fmtTime(shift.end_time)}${shift.role_note ? ` · ${shift.role_note}` : ''}`}
                          >
                            <span className="text-[9px] text-white font-medium truncate whitespace-nowrap">
                              {fmtTime(shift.start_time)}–{fmtTime(shift.end_time)}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface ComplianceStoreProps {
  store: {
    store_id: string
    store_address: string
    week1_published_at: string | null
    week2_published_at: string | null
    max_week_start: string | null
  }
  throughDate: (maxWeekStart: string | null) => string
}

function ComplianceRow({ store, throughDate }: ComplianceStoreProps) {
  const both = !!(store.week1_published_at && store.week2_published_at)
  const either = !!(store.week1_published_at || store.week2_published_at)
  const borderColor = both
    ? 'border-green-900/50'
    : either
    ? 'border-amber-900/50'
    : 'border-red-900/50'

  return (
    <div className={`bg-gray-900 border ${borderColor} rounded-xl grid grid-cols-[1fr_80px_80px_90px] gap-2 items-center px-3 py-2.5`}>
      <p className="text-xs font-medium text-white truncate pr-1">{store.store_address}</p>
      <WeekCell published={!!store.week1_published_at} publishedAt={store.week1_published_at} />
      <WeekCell published={!!store.week2_published_at} publishedAt={store.week2_published_at} />
      <p className="text-[11px] text-gray-400 text-center">{throughDate(store.max_week_start)}</p>
    </div>
  )
}

function WeekCell({ published, publishedAt }: { published: boolean; publishedAt: string | null }) {
  if (published) {
    const t = publishedAt
      ? new Date(publishedAt).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', timeZone: 'America/Chicago',
        })
      : ''
    return (
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-green-400 text-sm leading-none">✓</span>
        <span className="text-[9px] text-green-700">{t}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-center">
      <span className="text-red-500 text-sm leading-none">✗</span>
    </div>
  )
}

