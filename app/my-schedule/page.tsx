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

  const weekStart = getWeekMonday(weekOffset)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
  }, [])

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
              <p className="text-xl font-bold text-white">{totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)}</p>
              <p className="text-xs text-gray-500 mt-0.5">Hours</p>
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
                      {dayShifts.length === 0 ? (
                        <p className="text-sm text-gray-600 pt-1">Off</p>
                      ) : (
                        <div className="space-y-2">
                          {dayShifts.map((shift, j) => (
                            <div key={j}>
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className={`text-sm font-semibold ${shift.is_on_call ? 'text-amber-300' : isToday ? 'text-violet-200' : 'text-white'}`}>
                                  {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
                                  {!shift.is_on_call && shift.break_minutes > 0 && (
                                    <span className="text-gray-500 font-normal text-xs ml-2">· {shift.break_minutes}m break</span>
                                  )}
                                </p>
                                {shift.is_on_call && (
                                  <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full">ON CALL</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-400 mt-0.5 truncate">{shift.store_address}</p>
                              {shift.role_note && (
                                <p className="text-xs text-violet-400 mt-0.5">{shift.role_note}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Hours badge — only for non-on-call shifts */}
                    {dayShifts.some(s => !s.is_on_call) && (
                      <div className="flex-shrink-0 text-right">
                        <span className={`text-xs font-semibold ${isToday ? 'text-violet-400' : 'text-gray-400'}`}>
                          {(() => {
                            const h = dayShifts.filter(s => !s.is_on_call).reduce((s, sh) => s + shiftHours(sh.start_time, sh.end_time, sh.break_minutes), 0)
                            return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`
                          })()}
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
            <p className="text-sm">No shifts scheduled for this week</p>
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
