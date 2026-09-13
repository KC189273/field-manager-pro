'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'

type Role = 'employee' | 'manager' | 'ops_field_leader' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'

interface Session { id: string; fullName: string; role: Role }

interface DayData {
  date: string; day_index: number
  shifts: { start_time: string; end_time: string; store_address: string; role_note: string | null }[]
  visit_notes: { store_address: string; reason: string }[]
  working: boolean
}

interface DmScheduleData {
  dm_id: string; dm_name: string; has_shifts: boolean; has_notes: boolean
  notes_updated_at: string | null; days: DayData[]
}

interface TodayDm {
  dm_id: string; dm_name: string
  shifts: { start_time: string; end_time: string; store_address: string; role_note: string | null }[]
  visit_notes: { store_address: string; reason: string }[]
  working: boolean
}

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getMonday(date: Date): string {
  const d = new Date(date); const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  return d.toISOString().split('T')[0]
}
function addWeeks(s: string, w: number): string {
  const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + w * 7)
  return d.toISOString().split('T')[0]
}
function shortAddr(a: string): string { return a.split(',')[0] }

type EditDay = { working: boolean; locations: { store_address: string; reason: string }[] }

export default function DmSchedulesPage() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [tab, setTab] = useState<'today' | 'week'>('today')
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [todayDms, setTodayDms] = useState<TodayDm[]>([])
  const [todayDate, setTodayDate] = useState('')
  const [todayLoading, setTodayLoading] = useState(true)
  const [dmSchedules, setDmSchedules] = useState<DmScheduleData[]>([])
  const [weekLoading, setWeekLoading] = useState(false)
  const [filterDmId, setFilterDmId] = useState('')
  const [expandedDm, setExpandedDm] = useState<string | null>(null)
  const [stores, setStores] = useState<{ id: string; address: string }[]>([])
  const [editing, setEditing] = useState(false)
  const [editDays, setEditDays] = useState<EditDay[]>([])
  const [saving, setSaving] = useState(false)

  const isDm = session?.role === 'manager'
  const isLeadership = session && session.role !== 'manager'

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) { router.replace('/login'); return }
      if (!['manager', 'ops_field_leader', 'ops_manager', 'sales_director', 'owner', 'developer'].includes(d.role)) { router.replace('/dashboard'); return }
      if (d.role === 'manager') { setTab('week'); setExpandedDm(d.id) }
      setSession(d)
    })
  }, [router])

  // Load stores for DM edit
  useEffect(() => {
    if (isDm) {
      fetch('/api/clock/my-stores').then(r => r.ok ? r.json() : null).then(d => {
        if (d?.stores) setStores(d.stores)
      }).catch(() => {})
    }
  }, [isDm])

  // Today view — leadership only
  useEffect(() => {
    if (!session || isDm) return
    setTodayLoading(true)
    fetch('/api/dm-schedule?today=true').then(r => r.ok ? r.json() : { today: [], date: '' })
      .then(d => { setTodayDms(d.today ?? []); setTodayDate(d.date ?? '') })
      .finally(() => setTodayLoading(false))
  }, [session, isDm])

  const loadWeek = useCallback(() => {
    if (!session) return
    setWeekLoading(true)
    const p = new URLSearchParams({ weekStart })
    if (filterDmId) p.set('dmId', filterDmId)
    fetch(`/api/dm-schedule?${p}`).then(r => r.json())
      .then(d => setDmSchedules(d.dmSchedules ?? []))
      .finally(() => setWeekLoading(false))
  }, [session, weekStart, filterDmId])

  useEffect(() => { if (tab === 'week') loadWeek() }, [tab, loadWeek])

  // Initialize edit mode from current data
  function startEditing() {
    const mySchedule = dmSchedules[0]
    const days: EditDay[] = Array.from({ length: 7 }, (_, i) => {
      const day = mySchedule?.days?.[i]
      return {
        working: day?.working ?? (i < 5), // Default Mon-Fri working
        locations: day?.visit_notes?.length
          ? day.visit_notes.map(n => ({ store_address: n.store_address, reason: n.reason }))
          : [{ store_address: '', reason: '' }],
      }
    })
    setEditDays(days)
    setEditing(true)
  }

  // Copy last week's schedule
  async function copyLastWeek() {
    const prevWeek = addWeeks(weekStart, -1)
    const res = await fetch(`/api/dm-schedule?weekStart=${prevWeek}`).catch(() => null)
    if (!res?.ok) return
    const d = await res.json()
    const prev = d.dmSchedules?.[0]
    if (!prev) return
    const days: EditDay[] = Array.from({ length: 7 }, (_, i) => {
      const day = prev.days?.[i]
      return {
        working: day?.working ?? false,
        locations: day?.visit_notes?.length
          ? day.visit_notes.map((n: { store_address: string; reason: string }) => ({ store_address: n.store_address, reason: n.reason }))
          : [{ store_address: '', reason: '' }],
      }
    })
    setEditDays(days)
    setEditing(true)
  }

  function updateEditDay(dayIdx: number, field: 'working', value: boolean): void
  function updateEditDay(dayIdx: number, field: 'locations', value: { store_address: string; reason: string }[]): void
  function updateEditDay(dayIdx: number, field: 'working' | 'locations', value: boolean | { store_address: string; reason: string }[]) {
    setEditDays(prev => prev.map((d, i) => i === dayIdx ? { ...d, [field]: value } : d))
  }

  function addLocation(dayIdx: number) {
    setEditDays(prev => prev.map((d, i) => i === dayIdx ? { ...d, locations: [...d.locations, { store_address: '', reason: '' }] } : d))
  }

  function removeLocation(dayIdx: number, locIdx: number) {
    setEditDays(prev => prev.map((d, i) => i === dayIdx ? { ...d, locations: d.locations.filter((_, li) => li !== locIdx) } : d))
  }

  function updateLocation(dayIdx: number, locIdx: number, field: 'store_address' | 'reason', value: string) {
    setEditDays(prev => prev.map((d, i) => i === dayIdx ? {
      ...d,
      locations: d.locations.map((l, li) => li === locIdx ? { ...l, [field]: value } : l),
    } : d))
  }

  async function saveSchedule() {
    if (!session) return
    setSaving(true)
    const schedule = editDays.map((d, i) => ({
      day: i,
      working: d.working,
      locations: d.locations.filter(l => l.store_address || l.reason),
    }))
    await fetch('/api/dm-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStart, schedule }),
    }).catch(() => {})
    setEditing(false)
    setSaving(false)
    loadWeek()
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  const isCurrentWeek = weekStart === getMonday(new Date())
  const weekLabel = (() => {
    const s = new Date(weekStart + 'T12:00:00'), e = new Date(weekStart + 'T12:00:00')
    e.setDate(e.getDate() + 6)
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  })()
  const todayDayName = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Chicago' })
  const todayDateFmt = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
  const todayDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const workingDms = todayDms.filter(d => d.working)
  const offDms = todayDms.filter(d => !d.working)

  // DM's own today summary
  const myToday = isDm && dmSchedules[0] ? dmSchedules[0].days.find(d => d.date === todayDateStr) : null

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <h1 className="text-xl font-bold text-white mb-1">{isDm ? 'My DM Schedule' : 'DM Schedules'}</h1>
        <p className="text-xs text-gray-500 mb-4">{isDm ? 'Plan your weekly store visits' : 'See where your DMs are working'}</p>

        {/* DM today summary card */}
        {isDm && myToday && myToday.working && (
          <div className="bg-violet-900/20 border border-violet-800/30 rounded-2xl px-4 py-3 mb-4">
            <p className="text-xs text-violet-400 font-bold uppercase tracking-wide mb-1">Today — {todayDayName}</p>
            {myToday.shifts.map((s, i) => (
              <p key={i} className="text-sm text-white">{shortAddr(s.store_address)}{s.role_note ? <span className="text-gray-400"> — {s.role_note}</span> : ''}</p>
            ))}
            {myToday.visit_notes.filter(n => n.store_address || n.reason).map((n, i) => (
              <p key={`n-${i}`} className="text-sm text-white">{n.store_address ? shortAddr(n.store_address) : ''}{n.store_address && n.reason ? <span className="text-gray-400"> — </span> : ''}<span className="text-amber-400">{n.reason}</span></p>
            ))}
            {myToday.shifts.length === 0 && myToday.visit_notes.length === 0 && (
              <p className="text-sm text-gray-400 italic">Working — no details entered yet</p>
            )}
          </div>
        )}

        {/* Tab switcher — leadership sees both, DMs only see week */}
        {isLeadership && (
          <div className="flex gap-1 mb-5 bg-gray-900 border border-gray-800 rounded-xl p-1">
            {(['today', 'week'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${tab === t ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                {t === 'today' ? 'Today' : 'Weekly View'}
              </button>
            ))}
          </div>
        )}

        {/* ── TODAY (leadership only) ── */}
        {tab === 'today' && isLeadership && (
          <div>
            <div className="bg-violet-900/20 border border-violet-800/30 rounded-2xl px-4 py-3 mb-4">
              <p className="text-sm font-semibold text-white">{todayDayName}</p>
              <p className="text-xs text-violet-400">{todayDateFmt}</p>
            </div>
            {todayLoading ? <div className="text-center text-gray-500 py-10 text-sm">Loading...</div> : (
              <div className="space-y-3">
                {workingDms.length === 0 && offDms.length === 0 && <p className="text-gray-500 text-sm text-center py-8">No DMs found.</p>}
                {workingDms.map(dm => (
                  <div key={dm.dm_id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-800/50 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-400" />
                        <span className="text-sm font-semibold text-white">{dm.dm_name}</span>
                      </div>
                      <span className="text-[10px] text-gray-500">{dm.shifts.length} store{dm.shifts.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="px-4 py-2 space-y-1.5">
                      {dm.shifts.map((s, i) => (
                        <p key={i} className="text-sm text-gray-300">{shortAddr(s.store_address)}{s.role_note ? <span className="text-gray-500"> — {s.role_note}</span> : ''}</p>
                      ))}
                      {dm.visit_notes.filter(n => n.reason).map((n, i) => (
                        <p key={`n-${i}`} className="text-sm text-gray-300">{n.store_address ? shortAddr(n.store_address) : ''}{n.store_address && n.reason ? <span className="text-gray-500"> — </span> : ''}<span className="text-amber-400/70">{n.reason}</span></p>
                      ))}
                    </div>
                  </div>
                ))}
                {offDms.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-gray-600 uppercase tracking-wide font-medium mb-2">No schedule today</p>
                    <div className="flex flex-wrap gap-2">
                      {offDms.map(dm => (
                        <span key={dm.dm_id} className="text-xs text-gray-500 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5">{dm.dm_name}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── WEEKLY VIEW ── */}
        {(tab === 'week' || isDm) && (
          <div>
            <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 mb-4">
              <button onClick={() => { setWeekStart(addWeeks(weekStart, -1)); setEditing(false) }} className="text-gray-400 hover:text-white p-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <div className="text-center">
                <p className="text-sm font-semibold text-white">{weekLabel}</p>
                {isCurrentWeek && <p className="text-[10px] text-violet-400 font-semibold">CURRENT WEEK</p>}
              </div>
              <button onClick={() => { setWeekStart(addWeeks(weekStart, 1)); setEditing(false) }} className="text-gray-400 hover:text-white p-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>

            {/* DM action buttons */}
            {isDm && !editing && (
              <div className="flex gap-2 mb-4">
                <button onClick={startEditing} className="flex-1 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                  Edit Schedule
                </button>
                <button onClick={copyLastWeek} className="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold rounded-xl transition-colors">
                  Copy Last Week
                </button>
              </div>
            )}

            {!isCurrentWeek && !isDm && (
              <button onClick={() => setWeekStart(getMonday(new Date()))} className="w-full text-xs text-violet-400 hover:text-violet-300 font-semibold py-2 bg-gray-900 border border-gray-800 rounded-xl mb-4">Jump to Current Week</button>
            )}

            {/* DM filter chips — leadership only */}
            {isLeadership && dmSchedules.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                <button onClick={() => { setFilterDmId(''); setExpandedDm(null) }} className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${!filterDmId ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>All DMs</button>
                {dmSchedules.map(dm => (
                  <button key={dm.dm_id} onClick={() => { setFilterDmId(f => f === dm.dm_id ? '' : dm.dm_id); setExpandedDm(dm.dm_id) }}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${filterDmId === dm.dm_id ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{dm.dm_name.split(' ')[0]}</button>
                ))}
              </div>
            )}

            {/* ── EDIT MODE (DM only) ── */}
            {isDm && editing && (
              <div className="space-y-2 mb-4">
                {editDays.map((day, i) => (
                  <div key={i} className={`bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden ${!day.working ? 'opacity-50' : ''}`}>
                    <div className="px-4 py-2.5 flex items-center justify-between border-b border-gray-800/50">
                      <span className="text-sm font-semibold text-white">{DAY_SHORT[i]}</span>
                      <button onClick={() => updateEditDay(i, 'working', !day.working)}
                        className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${day.working ? 'bg-green-900/40 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                        {day.working ? 'Working' : 'Off'}
                      </button>
                    </div>
                    {day.working && (
                      <div className="px-4 py-2 space-y-2">
                        {day.locations.map((loc, li) => (
                          <div key={li} className="flex gap-1.5 items-center">
                            <select value={loc.store_address} onChange={e => updateLocation(i, li, 'store_address', e.target.value)}
                              className="bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-1.5 flex-1 focus:outline-none focus:border-violet-500">
                              <option value="">Store...</option>
                              {stores.map(s => <option key={s.id} value={s.address}>{shortAddr(s.address)}</option>)}
                            </select>
                            <input type="text" placeholder="Visit reason" value={loc.reason}
                              onChange={e => updateLocation(i, li, 'reason', e.target.value)}
                              className="bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-1.5 flex-1 focus:outline-none focus:border-violet-500" />
                            {day.locations.length > 1 && (
                              <button onClick={() => removeLocation(i, li)} className="text-red-500 hover:text-red-400 shrink-0 p-1">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            )}
                          </div>
                        ))}
                        <button onClick={() => addLocation(i)} className="text-xs text-violet-400 hover:text-violet-300 font-semibold py-1">
                          + Add Store Visit
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <button onClick={saveSchedule} disabled={saving}
                    className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold py-3 rounded-xl transition-colors">
                    {saving ? 'Saving...' : 'Save Schedule'}
                  </button>
                  <button onClick={() => setEditing(false)}
                    className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold rounded-xl transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── READ MODE ── */}
            {(!isDm || !editing) && (
              <>
                {weekLoading ? <div className="text-center text-gray-500 py-10 text-sm">Loading...</div> : (
                  <div className="space-y-3">
                    {dmSchedules.length === 0 && <p className="text-gray-500 text-sm text-center py-8">No DM schedules found for this week.</p>}
                    {dmSchedules.map(dm => {
                      const isExp = expandedDm === dm.dm_id || filterDmId === dm.dm_id || dmSchedules.length === 1
                      const totalStores = dm.days.reduce((s, d) => s + d.shifts.length + d.visit_notes.length, 0)
                      const workDays = dm.days.filter(d => d.working).length
                      return (
                        <div key={dm.dm_id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                          {!isDm && (
                            <button onClick={() => setExpandedDm(expandedDm === dm.dm_id ? null : dm.dm_id)} className="w-full px-4 py-3 flex items-center justify-between text-left">
                              <div>
                                <p className="text-sm font-semibold text-white">{dm.dm_name}</p>
                                <p className="text-xs text-gray-500">
                                  {workDays} day{workDays !== 1 ? 's' : ''} · {totalStores} visit{totalStores !== 1 ? 's' : ''}
                                  {!dm.has_shifts && !dm.has_notes && <span className="text-amber-400 ml-1">· No schedule submitted</span>}
                                </p>
                              </div>
                              <svg className={`w-4 h-4 text-gray-500 transition-transform ${isExp ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                            </button>
                          )}
                          {(isExp || isDm) && (
                            <div className={!isDm ? 'border-t border-gray-800/50' : ''}>
                              {dm.days.map((day, i) => {
                                const isToday = day.date === todayDateStr
                                return (
                                  <div key={i} className={`px-4 py-2 border-b border-gray-800/30 last:border-0 ${!day.working ? 'opacity-40' : ''} ${isToday ? 'bg-violet-900/10' : ''}`}>
                                    <div className="flex items-start gap-3">
                                      <div className="w-10 shrink-0">
                                        <span className={`text-xs font-semibold ${isToday ? 'text-violet-400' : day.working ? 'text-gray-400' : 'text-gray-600'}`}>{DAY_SHORT[i]}</span>
                                        {isToday && <div className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-0.5" />}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        {day.working ? (
                                          <>
                                            {day.shifts.map((s, si) => (
                                              <p key={si} className="text-sm text-gray-300 mb-0.5" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{shortAddr(s.store_address)}{s.role_note ? <span className="text-gray-500"> — {s.role_note}</span> : ''}</p>
                                            ))}
                                            {day.visit_notes.filter(n => n.reason || n.store_address).map((n, ni) => (
                                              <p key={`vn-${ni}`} className="text-sm text-gray-300 mb-0.5" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{n.store_address ? shortAddr(n.store_address) : ''}{n.store_address && n.reason ? <span className="text-gray-500"> — </span> : ''}{n.reason && <span className="text-amber-400/70">{n.reason}</span>}</p>
                                            ))}
                                            {day.shifts.length === 0 && day.visit_notes.filter(n => n.reason || n.store_address).length === 0 && (
                                              <p className="text-xs text-gray-600 italic">Working (no details)</p>
                                            )}
                                          </>
                                        ) : <p className="text-xs text-gray-600 italic">Off</p>}
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
