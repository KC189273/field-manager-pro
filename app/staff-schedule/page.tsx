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
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'developer'
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
  employee_id: string
  employee_name: string
  shift_date: string   // YYYY-MM-DD
  start_time: string   // HH:MM:SS
  end_time: string
  role_note: string | null
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
  const [view, setView] = useState<'list' | 'gantt'>('list')
  const [ganttDay, setGanttDay] = useState(() => {
    const d = new Date().getDay()
    return d === 0 ? 6 : d - 1  // convert JS Sun=0 to Mon=0 index
  })

  // Modal
  const [modal, setModal] = useState<'add' | 'edit' | null>(null)
  const [editingShift, setEditingShift] = useState<Shift | null>(null)
  const [form, setForm] = useState({
    employeeId: '',
    shiftDate: '',
    startTime: '09:45',
    endTime: '19:00',
    roleNote: '',
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [modalError, setModalError] = useState('')

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
  const canUnpublish = session?.role === 'ops_manager' || session?.role === 'owner' || session?.role === 'developer'
  const scheduleIsLocked = isPublished && session?.role === 'manager'

  // Load session + stores + employees once
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
  }, [])

  useEffect(() => {
    if (!session || isEmployee) return
    Promise.all([
      fetch('/api/dm-store-locations').then(r => r.json()),
      fetch('/api/team/users').then(r => r.json()),
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

  const loadShifts = useCallback(async () => {
    if (!session) return
    setLoading(true)
    const params = new URLSearchParams({ weekStart })
    if (!isEmployee && selectedStore) params.set('storeId', selectedStore)
    const res = await fetch(`/api/staff-schedule?${params}`)
    if (res.ok) {
      const data = await res.json()
      setShifts(data.shifts ?? [])
      setIsPublished(data.isPublished ?? false)
    }
    setLoading(false)
  }, [session, weekStart, selectedStore, isEmployee])

  useEffect(() => {
    if (!session) return
    if (!isEmployee && !selectedStore) { setLoading(false); return }
    loadShifts()
  }, [loadShifts, session, isEmployee, selectedStore])

  function openAdd(shiftDate: string) {
    setEditingShift(null)
    setModalError('')
    setForm({
      employeeId: '',
      shiftDate,
      startTime: '09:45',
      endTime: '19:00',
      roleNote: '',
    })
    setModal('add')
  }

  function openEdit(shift: Shift) {
    setEditingShift(shift)
    setModalError('')
    setForm({
      employeeId: shift.employee_id,
      shiftDate: shift.shift_date,
      startTime: shift.start_time.slice(0, 5),
      endTime: shift.end_time.slice(0, 5),
      roleNote: shift.role_note ?? '',
    })
    setModal('edit')
  }

  async function saveShift() {
    setModalError('')
    if (!form.employeeId) { setModalError('Please select an employee.'); return }
    if (!form.shiftDate) { setModalError('Please select a date.'); return }
    if (!form.startTime || !form.endTime) { setModalError('Please set start and end times.'); return }
    setSaving(true)
    try {
      const payload = modal === 'edit' && editingShift
        ? { shiftId: editingShift.id, employeeId: form.employeeId, shiftDate: form.shiftDate, startTime: form.startTime, endTime: form.endTime, roleNote: form.roleNote || null }
        : { storeId: selectedStore, employeeId: form.employeeId, shiftDate: form.shiftDate, startTime: form.startTime, endTime: form.endTime, roleNote: form.roleNote || null }

      const res = await fetch('/api/staff-schedule', {
        method: modal === 'edit' && editingShift ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setModalError(d.error ?? `Save failed (${res.status}). Please try again.`)
        return
      }
      setModal(null)
      await loadShifts()
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
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  async function publishWeek() {
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

  if (!session) return <div className="min-h-screen bg-gray-950" />

  // ── Employee read-only view ──────────────────────────────────────────────
  if (isEmployee) {
    return (
      <div className="min-h-screen bg-gray-950 pb-20 pt-14">
        <NavBar role={session.role} fullName={session.fullName} />
        <div className="px-4 pt-6 max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-5">
            <h1 className="text-xl font-bold text-white">My Schedule</h1>
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
          ) : shifts.length === 0 ? (
            <div className="text-center text-gray-500 py-12">No schedule posted for this week</div>
          ) : (
            <div className="space-y-3">
              {days.map((day, i) => {
                const dateStr = toDateStr(day)
                const dayShifts = shifts.filter(s => s.shift_date === dateStr)
                if (dayShifts.length === 0) return null
                return (
                  <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 bg-gray-800/40 border-b border-gray-800">
                      <p className="text-sm font-semibold text-white">{DAY_NAMES[i]}</p>
                      <p className="text-xs text-gray-500">{fmtDate(day)}</p>
                    </div>
                    {dayShifts.map(shift => (
                      <div key={shift.id} className="px-4 py-3 border-b border-gray-800/50 last:border-0">
                        <p className="text-sm font-medium text-white">
                          {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{shift.store_address}</p>
                        {shift.role_note && (
                          <p className="text-xs text-violet-400 mt-0.5">{shift.role_note}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Manager+ view ────────────────────────────────────────────────────────
  const currentStore = stores.find(s => s.id === selectedStore)

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-4 pt-6 max-w-2xl mx-auto">
        {/* Title row */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-white">Staff Schedule</h1>
          <div className="flex items-center gap-2">
            {/* List / Gantt toggle */}
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
            </div>
          </div>
        </div>

        {/* Week nav */}
        <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 mb-3">
          <button onClick={() => setWeekOffset(w => w - 1)} className="text-gray-400 hover:text-white text-xl px-1 transition-colors">‹</button>
          <div className="text-center">
            <p className="text-sm font-semibold text-white">{weekLabel}</p>
            {weekOffset === 0 && <p className="text-[10px] text-violet-400">Current Week</p>}
            {weekOffset === 1 && <p className="text-[10px] text-gray-500">Next Week</p>}
          </div>
          <button onClick={() => setWeekOffset(w => w + 1)} className="text-gray-400 hover:text-white text-xl px-1 transition-colors">›</button>
        </div>

        {/* Store selector */}
        {stores.length > 1 ? (
          <select
            value={selectedStore}
            onChange={e => setSelectedStore(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 text-sm text-white mb-3 focus:outline-none focus:border-violet-500"
          >
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.address}</option>
            ))}
          </select>
        ) : currentStore ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 mb-3">
            <p className="text-xs text-gray-500">Store</p>
            <p className="text-sm text-white truncate">{currentStore.address}</p>
          </div>
        ) : null}

        {/* Publish bar */}
        {selectedStore && (
          <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 mb-5">
            <div>
              <p className="text-xs text-gray-500">Status</p>
              <p className={`text-sm font-semibold ${isPublished ? 'text-green-400' : 'text-yellow-500'}`}>
                {isPublished ? '✓ Published — employees can see this' : 'Draft — not visible to employees'}
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
              {!isPublished && (
                <button
                  onClick={publishWeek}
                  disabled={publishing || shifts.length === 0}
                  className="text-xs bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                >
                  {publishing ? 'Publishing…' : 'Publish Week'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* No stores state */}
        {!selectedStore && (
          <div className="text-center text-gray-500 py-16">
            <p className="text-sm">No stores assigned to you yet.</p>
            <p className="text-xs mt-1">Contact your ops manager to get stores assigned.</p>
          </div>
        )}

        {/* Content */}
        {selectedStore && loading ? (
          <div className="text-center text-gray-500 py-12">Loading…</div>
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
                        <div key={shift.id} className="flex items-center justify-between px-4 py-3 gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">{shift.employee_name}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
                            </p>
                            {shift.role_note && (
                              <p className="text-xs text-violet-400 mt-0.5">{shift.role_note}</p>
                            )}
                          </div>
                          {!scheduleIsLocked && (
                            <button
                              onClick={() => openEdit(shift)}
                              className="shrink-0 text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-2.5 py-1 rounded-lg transition-colors"
                            >
                              Edit
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
            className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-white mb-5">
              {modal === 'edit' ? 'Edit Shift' : 'Add Shift'}
            </h2>

            <div className="space-y-4">
              {/* Employee */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Employee</label>
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
              </div>

              {/* Date */}
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
                  {saving ? 'Saving…' : modal === 'edit' ? 'Save Changes' : 'Add Shift'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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

  // Unique employees for this day
  const empMap = new Map<string, string>()
  dayShifts.forEach(s => empMap.set(s.employee_id, s.employee_name))
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
                const empShifts = dayShifts.filter(s => s.employee_id === empId)
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
