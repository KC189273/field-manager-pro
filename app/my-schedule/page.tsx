'use client'

import { useState, useEffect } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface Shift {
  shift_date: string
  start_time: string
  end_time: string
  store_address: string
  role_note: string | null
  break_minutes: number
  is_on_call: boolean
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getWeekMonday(offsetWeeks = 0): string {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff + offsetWeeks * 7)
  d.setHours(0, 0, 0, 0)
  return d.toISOString().split('T')[0]
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function shiftHours(start: string, end: string, breakMins: number): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const raw = (eh * 60 + em - (sh * 60 + sm)) / 60
  return Math.max(0, raw - breakMins / 60)
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart + 'T12:00:00')
  const end = new Date(weekStart + 'T12:00:00')
  end.setDate(end.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`
}

interface Store { id: string; address: string }
interface StoreShift {
  shift_date: string
  start_time: string
  end_time: string
  employee_name: string
  employee_id: string
  role_note: string | null
  is_on_call: boolean
}

export default function MySchedulePage() {
  const [session, setSession] = useState<Session | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)

  // Store schedule lookup (employees only)
  const [stores, setStores] = useState<Store[]>([])
  const [selectedStore, setSelectedStore] = useState('')
  const [storeShifts, setStoreShifts] = useState<StoreShift[]>([])
  const [storeLoading, setStoreLoading] = useState(false)

  // DM self-scheduling
  const [dmStores, setDmStores] = useState<Store[]>([])
  const [addDay, setAddDay] = useState<string | null>(null)
  const [addForm, setAddForm] = useState({ storeId: '', startTime: '09:00', endTime: '17:00', note: '' })
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')
  const [editingShift, setEditingShift] = useState<{ date: string; startTime: string; storeAddress: string } | null>(null)

  const weekStart = getWeekMonday(weekOffset)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
  }, [])

  // Load DM's stores for self-scheduling
  useEffect(() => {
    if (!session || session.role !== 'manager') return
    fetch('/api/dm-store-locations').then(r => r.json()).then(d => {
      if (d.locations) setDmStores(d.locations.filter((l: Store & { active: boolean }) => l.active))
    })
  }, [session])

  const isDm = session?.role === 'manager'

  async function addDmShift() {
    if (!addDay || !addForm.storeId) {
      setAddError('Please select a store.')
      return
    }
    setAddSaving(true)
    setAddError('')

    // If editing, delete the old shift first
    if (editingShift) {
      await deleteDmShift(editingShift.date, editingShift.startTime, editingShift.storeAddress, true)
    }

    const res = await fetch('/api/staff-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: addForm.storeId,
        employeeId: session!.id,
        shiftDate: addDay,
        startTime: addForm.startTime,
        endTime: addForm.endTime,
        roleNote: addForm.note || null,
        breakMinutes: 0,
        isOnCall: false,
        isDmShift: true,
      }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setAddError(d.error ?? 'Failed to add shift')
      setAddSaving(false)
      return
    }
    // Auto-publish so it shows immediately
    await fetch('/api/staff-schedule/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: addForm.storeId, weekStart }),
    }).catch(() => {})
    setAddDay(null)
    setAddForm({ storeId: '', startTime: '09:00', endTime: '17:00', note: '' })
    setAddSaving(false)
    // Reload shifts
    setLoading(true)
    const p = new URLSearchParams({ weekStart })
    const r = await fetch(`/api/my-schedule?${p}`)
    if (r.ok) { const d = await r.json(); setShifts(d.shifts ?? []) }
    setLoading(false)
  }

  async function deleteDmShift(shiftDate: string, startTime: string, storeAddress: string, silent = false) {
    if (!silent && !confirm(`Remove your shift at ${storeAddress.split(',')[0]}?`)) return
    // Find the shift ID from staff-schedule
    const res = await fetch(`/api/staff-schedule?weekStart=${weekStart}`)
    if (!res.ok) return
    const d = await res.json()
    const match = (d.shifts ?? []).find((s: { employee_id: string; shift_date: string; start_time: string }) =>
      s.employee_id === session!.id && s.shift_date === shiftDate && s.start_time === startTime
    )
    if (!match) return
    await fetch('/api/staff-schedule', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shiftId: match.id }),
    })
    // Reload
    setLoading(true)
    const p = new URLSearchParams({ weekStart })
    const r2 = await fetch(`/api/my-schedule?${p}`)
    if (r2.ok) { const d2 = await r2.json(); setShifts(d2.shifts ?? []) }
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ weekStart })
    if (selectedStore) params.set('storeId', selectedStore)
    fetch(`/api/my-schedule?${params}`)
      .then(r => r.json())
      .then(d => {
        setShifts(d.shifts ?? [])
        if (d.stores) setStores(d.stores)
        setStoreShifts(d.storeShifts ?? [])
      })
      .finally(() => setLoading(false))
  }, [weekStart, selectedStore])

  async function loadStoreSchedule(storeId: string) {
    setSelectedStore(storeId)
    if (!storeId) { setStoreShifts([]); return }
    setStoreLoading(true)
    const res = await fetch(`/api/my-schedule?weekStart=${weekStart}&storeId=${storeId}`)
    if (res.ok) {
      const d = await res.json()
      setStoreShifts(d.storeShifts ?? [])
    }
    setStoreLoading(false)
  }

  const today = new Date().toISOString().split('T')[0]

  const totalHours = shifts.filter(s => !s.is_on_call).reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time, s.break_minutes), 0)
  const daysWorking = new Set(shifts.filter(s => !s.is_on_call).map(s => s.shift_date)).size

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="px-4 pt-6 max-w-lg mx-auto">
        {/* Header + week nav */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-white">My Schedule</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setWeekOffset(w => w - 1)}
              disabled={weekOffset <= -1}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => setWeekOffset(0)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${weekOffset === 0 ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
            >
              This Week
            </button>
            <button
              onClick={() => setWeekOffset(w => w + 1)}
              disabled={weekOffset >= 2}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Week label */}
        <p className="text-sm text-gray-400 mb-4">
          {weekOffset === 0 ? 'This Week' : weekOffset === 1 ? 'Next Week' : weekOffset === -1 ? 'Last Week' : ''}{' '}
          <span className="text-gray-500">· {formatWeekRange(weekStart)}</span>
        </p>

        {/* Summary bar */}
        {!loading && shifts.length > 0 && (
          <div className="flex gap-3 mb-5">
            <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-center">
              <p className="text-xl font-bold text-white">{shifts.length}</p>
              <p className="text-xs text-gray-500 mt-0.5">Store{shifts.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-center">
              <p className="text-xl font-bold text-white">{daysWorking}</p>
              <p className="text-xs text-gray-500 mt-0.5">Days Scheduled</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-500 py-12">Loading…</div>
        ) : (
          <div className="space-y-2">
            {DAY_NAMES.map((dayName, i) => {
              const dayDate = addDays(weekStart, i)
              const dayShifts = shifts.filter(s => s.shift_date === dayDate)
              const isToday = dayDate === today

              return (
                <div
                  key={dayDate}
                  className={`rounded-2xl border p-4 ${isToday ? 'border-violet-700 bg-violet-950/30' : 'border-gray-800 bg-gray-900'}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Day label */}
                    <div className="flex-shrink-0 w-14 text-center">
                      <p className={`text-xs font-semibold uppercase tracking-wide ${isToday ? 'text-violet-400' : 'text-gray-500'}`}>
                        {DAY_SHORT[i]}
                      </p>
                      <p className={`text-lg font-bold leading-tight ${isToday ? 'text-violet-300' : 'text-gray-400'}`}>
                        {fmtDate(dayDate).split(' ')[1]}
                      </p>
                    </div>

                    {/* Shifts or off */}
                    <div className="flex-1 min-w-0">
                      {dayShifts.length === 0 && !isDm ? (
                        <p className="text-sm text-gray-600 pt-1">Off</p>
                      ) : dayShifts.length === 0 && isDm ? (
                        <button onClick={() => { setEditingShift(null); setAddDay(dayDate); setAddForm({ storeId: '', startTime: '09:00', endTime: '17:00', note: '' }); setAddError('') }}
                          className="text-sm text-violet-400 hover:text-violet-300 font-medium pt-1 transition-colors">
                          + Add store
                        </button>
                      ) : (
                        <div className="space-y-2">
                          {dayShifts.map((shift, j) => (
                            <div key={j} onClick={isDm ? () => { const matchStore = dmStores.find(s => s.address === shift.store_address); setEditingShift({ date: dayDate, startTime: shift.start_time, storeAddress: shift.store_address }); setAddDay(dayDate); setAddForm({ storeId: matchStore?.id ?? '', startTime: shift.start_time, endTime: shift.end_time, note: shift.role_note ?? '' }); setAddError('') } : undefined}
                              className={isDm ? 'cursor-pointer hover:bg-gray-800/50 rounded-lg px-1 -mx-1 transition-colors' : ''}>
                              <p className={`text-sm font-semibold ${isToday ? 'text-violet-200' : 'text-white'}`}>
                                {shift.store_address}
                              </p>
                              {shift.role_note && (
                                <p className="text-xs text-violet-400 mt-0.5 leading-relaxed" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{shift.role_note}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* DM: add + edit hint */}
                    {isDm && dayShifts.length > 0 && (
                      <div className="mt-1.5">
                        <button onClick={() => { setEditingShift(null); setAddDay(dayDate); setAddForm({ storeId: '', startTime: '09:00', endTime: '17:00', note: '' }); setAddError('') }}
                          className="text-[10px] text-violet-400 hover:text-violet-300 font-semibold">+ Add Store</button>
                        <span className="text-[10px] text-gray-600 ml-2">Tap a store to edit</span>
                      </div>
                    )}

                    {/* Store count badge */}
                    {dayShifts.length > 0 && (
                      <div className="flex-shrink-0 text-right">
                        <span className={`text-xs font-semibold ${isToday ? 'text-violet-400' : 'text-gray-400'}`}>
                          {dayShifts.length} store{dayShifts.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!loading && shifts.length === 0 && (
          <div className="text-center text-gray-500 py-12">
            <p className="text-sm">{isDm ? 'No shifts yet — tap a day above to add your schedule' : 'No shifts scheduled for this week'}</p>
          </div>
        )}

        {/* ── DM Add Shift Modal ── */}
        {addDay && isDm && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => { setAddDay(null); setEditingShift(null) }}>
            <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md border border-gray-800 p-6" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-white mb-1">{editingShift ? 'Edit Store Visit' : 'Add Store Visit'}</h2>
              <p className="text-xs text-gray-500 mb-4">
                {new Date(addDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Store</label>
                  <select value={addForm.storeId} onChange={e => setAddForm(f => ({ ...f, storeId: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500">
                    <option value="">Select store...</option>
                    {dmStores.map(s => <option key={s.id} value={s.id}>{s.address}</option>)}
                  </select>
                </div>
                {/* Times hidden — not needed for DM store visit planning */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Visit reason / notes</label>
                  <textarea value={addForm.note} onChange={e => setAddForm(f => ({ ...f, note: e.target.value }))}
                    placeholder="Why this store? What will you cover during your visit?"
                    rows={3}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none" />
                </div>
                {addError && <p className="text-sm text-red-400">{addError}</p>}
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={addDmShift} disabled={addSaving || !addForm.storeId}
                  className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors">
                  {addSaving ? 'Saving...' : editingShift ? 'Save Changes' : 'Add Store'}
                </button>
                {editingShift && (
                  <button onClick={() => { deleteDmShift(editingShift.date, editingShift.startTime, editingShift.storeAddress); setAddDay(null); setEditingShift(null) }}
                    className="px-4 py-3 bg-red-900/40 hover:bg-red-900/60 text-red-400 font-semibold rounded-xl text-sm transition-colors">
                    Remove
                  </button>
                )}
                <button onClick={() => { setAddDay(null); setEditingShift(null) }}
                  className={`${editingShift ? 'px-4' : 'flex-1'} bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-3 rounded-xl text-sm transition-colors`}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Store Schedule lookup (employees only) ── */}
        {session?.role === 'employee' && stores.length > 0 && (
          <div className="mt-8">
            <div className="border-t border-gray-800 pt-7 mb-5">
              <h2 className="text-base font-bold text-white mb-0.5">Store Schedule</h2>
              <p className="text-xs text-gray-500">See who's working at a store this week — helpful for finding someone to swap with.</p>
            </div>

            <select
              value={selectedStore}
              onChange={e => loadStoreSchedule(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500 mb-4"
            >
              <option value="">Select a store…</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.address}</option>)}
            </select>

            {selectedStore && (
              storeLoading ? (
                <div className="text-center text-gray-500 py-8">Loading…</div>
              ) : storeShifts.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 text-sm">No published shifts at this store for this week</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {DAY_NAMES.map((dayName, i) => {
                    const dayDate = addDays(weekStart, i)
                    const dayShifts = storeShifts.filter(s => s.shift_date === dayDate)
                    if (dayShifts.length === 0) return null
                    const isToday = dayDate === today
                    return (
                      <div key={dayDate} className={`rounded-2xl border p-4 ${isToday ? 'border-violet-700 bg-violet-950/30' : 'border-gray-800 bg-gray-900'}`}>
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-14 text-center">
                            <p className={`text-xs font-semibold uppercase tracking-wide ${isToday ? 'text-violet-400' : 'text-gray-500'}`}>
                              {DAY_SHORT[i]}
                            </p>
                            <p className={`text-lg font-bold leading-tight ${isToday ? 'text-violet-300' : 'text-gray-400'}`}>
                              {fmtDate(dayDate).split(' ')[1]}
                            </p>
                          </div>
                          <div className="flex-1 min-w-0 space-y-2">
                            {dayShifts.map((s, j) => (
                              <div key={j} className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className={`text-sm font-semibold truncate ${s.employee_id === session.id ? 'text-violet-300' : 'text-white'}`}>
                                    {s.employee_name}
                                    {s.employee_id === session.id && <span className="text-violet-500 text-xs font-normal ml-1">(you)</span>}
                                  </p>
                                  {s.role_note && <p className="text-[11px] text-violet-400">{s.role_note}</p>}
                                </div>
                                <div className="text-right shrink-0">
                                  <p className={`text-xs font-semibold ${s.is_on_call ? 'text-amber-400' : 'text-gray-400'}`}>
                                    {s.is_on_call ? 'On Call' : `${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}`}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
