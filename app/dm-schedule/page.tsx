'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'

type Role = 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'

interface Session {
  id: string; fullName: string; role: Role; org_id?: string | null
}

interface LocationEntry {
  store_id: string
  store_address: string
  reason: string
}

interface DaySchedule {
  day: number // 0=Mon, 1=Tue, ..., 6=Sun
  working: boolean
  locations: LocationEntry[]
}

interface WeekSchedule {
  id: string
  dm_id: string
  dm_name: string
  week_start: string
  schedule: DaySchedule[]
  updated_at: string
}

interface Store {
  id: string
  address: string
}

interface DmUser {
  id: string
  full_name: string
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const canViewAll = (role: string) => role === 'sales_director' || role === 'owner' || role === 'developer'
const canEdit = (role: string) => role === 'manager' || role === 'developer'

function getMonday(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d.toISOString().split('T')[0]
}

function addWeeks(dateStr: string, weeks: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + weeks * 7)
  return d.toISOString().split('T')[0]
}

function emptyWeek(): DaySchedule[] {
  return Array.from({ length: 7 }, (_, i) => ({
    day: i,
    working: i < 5, // Mon-Fri default to working
    locations: [],
  }))
}

export default function DmSchedulePage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [schedules, setSchedules] = useState<WeekSchedule[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [dmUsers, setDmUsers] = useState<DmUser[]>([])
  const [filterDmId, setFilterDmId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [editSchedule, setEditSchedule] = useState<DaySchedule[]>(emptyWeek())
  const [editingDay, setEditingDay] = useState<number | null>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasLoadedRef = useRef(false)
  const latestScheduleRef = useRef<DaySchedule[]>(emptyWeek())

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => {
      if (!d) return
      if (d.role === 'employee') { router.replace('/dashboard'); return }
      setSession(d)
    })
  }, [router])

  // Load stores for the DM
  useEffect(() => {
    if (!session) return
    fetch('/api/dm-store-locations').then(r => r.json()).then(d => {
      if (d.locations) setStores(d.locations.filter((l: Store & { active: boolean }) => l.active))
    })
    // Load DM list for admin filter
    if (canViewAll(session.role)) {
      fetch('/api/team/users').then(r => r.json()).then(d => {
        if (d.users) setDmUsers(d.users.filter((u: DmUser & { role: string }) => u.role === 'manager'))
      })
    }
  }, [session])

  const loadSchedules = useCallback(() => {
    if (!session) return
    // Cancel any pending auto-save from the previous week
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null }
    hasLoadedRef.current = false
    setLoading(true)
    const params = new URLSearchParams({ weekStart })
    if (filterDmId) params.set('dmId', filterDmId)
    fetch(`/api/dm-schedule?${params}`)
      .then(r => r.json())
      .then(d => {
        const scheds = d.schedules ?? []
        setSchedules(scheds)
        // If DM, load their schedule into the editor
        if (canEdit(session.role)) {
          const mine = scheds.find((s: WeekSchedule) => s.dm_id === session.id)
          const loaded = mine ? mine.schedule : emptyWeek()
          setEditSchedule(loaded)
          latestScheduleRef.current = loaded
          // Delay enabling auto-save so initial state set doesn't trigger it
          setTimeout(() => { hasLoadedRef.current = true }, 500)
        }
      })
      .finally(() => setLoading(false))
  }, [session, weekStart, filterDmId])

  useEffect(() => { loadSchedules() }, [loadSchedules])

  async function doSave(schedule: DaySchedule[], forWeek?: string) {
    const saveWeek = forWeek ?? weekStart
    setSaving(true)
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/dm-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart: saveWeek, schedule }),
      })
      if (res.ok) {
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus(prev => prev === 'saved' ? 'idle' : prev), 3000)
      } else {
        console.error('DM Schedule save failed:', res.status)
        setSaveStatus('error')
      }
    } catch (err) {
      console.error('DM Schedule save error:', err)
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }

  // Keep ref in sync for blur-save
  useEffect(() => { latestScheduleRef.current = editSchedule }, [editSchedule])

  // Auto-save: debounce 2 seconds after any edit — captures weekStart at trigger time
  function triggerAutoSave(updated: DaySchedule[]) {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    setSaveStatus('idle')
    const capturedWeek = weekStart
    autoSaveTimer.current = setTimeout(() => doSave(updated, capturedWeek), 2000)
  }

  // Wrapper to update state AND trigger auto-save
  function updateSchedule(updater: (prev: DaySchedule[]) => DaySchedule[]) {
    setEditSchedule(prev => {
      const next = updater(prev)
      if (hasLoadedRef.current) triggerAutoSave(next)
      return next
    })
  }

  // Manual save button
  async function handleSave() {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    await doSave(latestScheduleRef.current)
  }

  function toggleWorking(dayIdx: number) {
    updateSchedule(prev => prev.map((d, i) => i === dayIdx ? { ...d, working: !d.working, locations: !d.working ? d.locations : [] } : d))
  }

  function addLocation(dayIdx: number) {
    updateSchedule(prev => prev.map((d, i) => i === dayIdx ? { ...d, locations: [...d.locations, { store_id: '', store_address: '', reason: '' }] } : d))
  }

  // Update location — auto-saves for store selection, but NOT for reason typing (saves on blur)
  function updateLocation(dayIdx: number, locIdx: number, field: 'store_id' | 'reason', value: string) {
    if (field === 'reason') {
      // For reason: update state only (no auto-save), save happens on blur
      setEditSchedule(prev => prev.map((d, i) => {
        if (i !== dayIdx) return d
        const locs = [...d.locations]
        locs[locIdx] = { ...locs[locIdx], reason: value }
        return { ...d, locations: locs }
      }))
    } else {
      // For store selection: update state AND trigger auto-save
      updateSchedule(prev => prev.map((d, i) => {
        if (i !== dayIdx) return d
        const locs = [...d.locations]
        const store = stores.find(s => s.id === value)
        locs[locIdx] = { ...locs[locIdx], store_id: value, store_address: store?.address ?? '' }
        return { ...d, locations: locs }
      }))
    }
  }

  // Save on blur for reason fields — uses ref for latest state
  function onReasonBlur() {
    if (hasLoadedRef.current) {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
      doSave(latestScheduleRef.current, weekStart)
    }
  }

  function removeLocation(dayIdx: number, locIdx: number) {
    updateSchedule(prev => prev.map((d, i) => i === dayIdx ? { ...d, locations: d.locations.filter((_, j) => j !== locIdx) } : d))
  }

  if (!session) return null

  const weekLabel = (() => {
    const start = new Date(weekStart + 'T12:00:00')
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  })()

  const isCurrentWeek = weekStart === getMonday(new Date())
  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500'

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-white">DM Schedule</h1>
          <p className="text-xs text-gray-500 mt-0.5">Plan your weekly store visits</p>
        </div>

        {/* Week Navigation */}
        <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3">
          <button onClick={() => setWeekStart(addWeeks(weekStart, -1))}
            className="text-gray-400 hover:text-white transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="text-center">
            <p className="text-sm font-semibold text-white">{weekLabel}</p>
            {isCurrentWeek && <p className="text-[10px] text-violet-400 font-semibold">CURRENT WEEK</p>}
          </div>
          <button onClick={() => setWeekStart(addWeeks(weekStart, 1))}
            className="text-gray-400 hover:text-white transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Today button */}
        {!isCurrentWeek && (
          <button onClick={() => setWeekStart(getMonday(new Date()))}
            className="w-full text-xs text-violet-400 hover:text-violet-300 font-semibold py-2 bg-gray-900 border border-gray-800 rounded-xl">
            Jump to Current Week
          </button>
        )}

        {/* Admin DM filter */}
        {canViewAll(session.role) && dmUsers.length > 0 && (
          <select value={filterDmId} onChange={e => setFilterDmId(e.target.value)}
            className={inputCls}>
            <option value="">All DMs</option>
            {dmUsers.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 animate-pulse">
                <div className="h-4 bg-gray-800 rounded w-24 mb-2" />
                <div className="h-3 bg-gray-800 rounded w-48" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* DM Edit View */}
            {canEdit(session.role) && (
              <div className="space-y-3">
                {editSchedule.map((day, dayIdx) => (
                  <div key={dayIdx} className={`bg-gray-900 border rounded-2xl overflow-hidden ${
                    day.working ? 'border-gray-800' : 'border-gray-800/50 opacity-60'
                  }`}>
                    {/* Day header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/50">
                      <button onClick={() => toggleWorking(dayIdx)} className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                          day.working ? 'bg-violet-600 border-violet-500' : 'border-gray-600'
                        }`}>
                          {day.working && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span className={`text-sm font-semibold ${day.working ? 'text-white' : 'text-gray-500'}`}>
                          {DAY_NAMES[dayIdx]}
                        </span>
                      </button>
                      {day.working && (
                        <button onClick={() => setEditingDay(editingDay === dayIdx ? null : dayIdx)}
                          className="text-xs text-violet-400 hover:text-violet-300 font-semibold">
                          {editingDay === dayIdx ? 'Done' : day.locations.length > 0 ? `${day.locations.length} location${day.locations.length !== 1 ? 's' : ''}` : '+ Add locations'}
                        </button>
                      )}
                    </div>

                    {/* Location summary (when not editing) */}
                    {day.working && editingDay !== dayIdx && day.locations.length > 0 && (
                      <div className="px-4 py-2">
                        {day.locations.map((loc, i) => (
                          <div key={i} className="py-1.5 border-b border-gray-800/30 last:border-0">
                            <p className="text-sm text-gray-300">{loc.store_address || 'No store selected'}</p>
                            {loc.reason && <p className="text-xs text-gray-500 mt-0.5">{loc.reason}</p>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Location editor (expanded) */}
                    {day.working && editingDay === dayIdx && (
                      <div className="px-4 py-3 space-y-3">
                        {day.locations.map((loc, locIdx) => (
                          <div key={locIdx} className="bg-gray-800/50 rounded-xl p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <select value={loc.store_id} onChange={e => updateLocation(dayIdx, locIdx, 'store_id', e.target.value)}
                                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500">
                                <option value="">Select store</option>
                                {stores.map(s => <option key={s.id} value={s.id}>{s.address}</option>)}
                              </select>
                              <button onClick={() => removeLocation(dayIdx, locIdx)}
                                className="text-gray-600 hover:text-red-400 transition-colors p-1">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                            <input type="text" value={loc.reason} onChange={e => updateLocation(dayIdx, locIdx, 'reason', e.target.value)}
                              onBlur={onReasonBlur}
                              placeholder="Why this location? What will you cover?"
                              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                          </div>
                        ))}
                        <button onClick={() => addLocation(dayIdx)}
                          className="w-full text-xs text-violet-400 hover:text-violet-300 font-semibold py-2 border border-dashed border-gray-700 rounded-xl hover:border-violet-600/50 transition-colors">
                          + Add Location
                        </button>
                      </div>
                    )}

                    {/* Off day label */}
                    {!day.working && (
                      <div className="px-4 py-2">
                        <p className="text-xs text-gray-600 italic">Day off</p>
                      </div>
                    )}
                  </div>
                ))}

                <div className="flex items-center gap-3">
                  <button onClick={handleSave} disabled={saving}
                    className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                    {saving ? 'Saving...' : 'Save Schedule'}
                  </button>
                  {saveStatus === 'saved' && (
                    <span className="text-green-400 text-xs font-medium flex items-center gap-1 shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Saved
                    </span>
                  )}
                  {saveStatus === 'error' && (
                    <span className="text-red-400 text-xs font-medium shrink-0">Save failed</span>
                  )}
                </div>
                <p className="text-center text-xs text-gray-600 mt-1">Changes auto-save as you type</p>
              </div>
            )}

            {/* Admin Read-Only View */}
            {canViewAll(session.role) && schedules.length > 0 && (
              <div className="space-y-4">
                {schedules.map(sched => (
                  <div key={sched.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">{sched.dm_name}</span>
                      <span className="text-[10px] text-gray-500">
                        Updated {new Date(sched.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })}
                      </span>
                    </div>
                    {sched.schedule.map((day: DaySchedule, i: number) => (
                      <div key={i} className={`px-4 py-2 border-b border-gray-800/30 last:border-0 ${!day.working ? 'opacity-40' : ''}`}>
                        <div className="flex items-start gap-3">
                          <span className={`text-xs font-semibold w-8 shrink-0 mt-0.5 ${day.working ? 'text-violet-400' : 'text-gray-600'}`}>
                            {DAY_SHORT[i]}
                          </span>
                          {day.working ? (
                            <div className="flex-1">
                              {day.locations.length === 0 ? (
                                <p className="text-xs text-gray-600 italic">No locations planned</p>
                              ) : day.locations.map((loc: LocationEntry, j: number) => (
                                <div key={j} className="mb-1 last:mb-0">
                                  <p className="text-sm text-gray-300">{loc.store_address}</p>
                                  {loc.reason && <p className="text-xs text-gray-500">{loc.reason}</p>}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-600 italic">Off</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* No schedules message for admins */}
            {canViewAll(session.role) && !canEdit(session.role) && schedules.length === 0 && (
              <div className="bg-gray-900/50 border border-dashed border-gray-800 rounded-2xl px-4 py-12 text-center">
                <p className="text-sm text-gray-500">No DM schedules submitted for this week</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
