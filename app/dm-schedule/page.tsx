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
function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
function shortAddr(a: string): string { return a.split(',')[0] }

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

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) { router.replace('/login'); return }
      if (!['ops_manager', 'sales_director', 'owner', 'developer'].includes(d.role)) { router.replace('/dashboard'); return }
      setSession(d)
    })
  }, [router])

  useEffect(() => {
    if (!session) return
    setTodayLoading(true)
    fetch('/api/dm-schedule?today=true').then(r => r.json())
      .then(d => { setTodayDms(d.today ?? []); setTodayDate(d.date ?? '') })
      .finally(() => setTodayLoading(false))
  }, [session])

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

  if (!session) return <div className="min-h-screen bg-gray-950" />

  const isCurrentWeek = weekStart === getMonday(new Date())
  const weekLabel = (() => {
    const s = new Date(weekStart + 'T12:00:00'), e = new Date(weekStart + 'T12:00:00')
    e.setDate(e.getDate() + 6)
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  })()
  const todayDayName = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Chicago' })
  const todayDateFmt = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
  const workingDms = todayDms.filter(d => d.working)
  const offDms = todayDms.filter(d => !d.working)

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <h1 className="text-xl font-bold text-white mb-1">DM Schedules</h1>
        <p className="text-xs text-gray-500 mb-4">See where your DMs are working</p>

        <div className="flex gap-1 mb-5 bg-gray-900 border border-gray-800 rounded-xl p-1">
          {(['today', 'week'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${tab === t ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {t === 'today' ? 'Today' : 'Weekly View'}
            </button>
          ))}
        </div>

        {/* ── TODAY ── */}
        {tab === 'today' && (
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
                        <div key={i}>
                          <p className="text-sm text-gray-300">{shortAddr(s.store_address)}{s.role_note ? <span className="text-gray-500"> — {s.role_note}</span> : ''}</p>
                        </div>
                      ))}
                      {dm.visit_notes.filter(n => n.reason).map((n, i) => (
                        <div key={`n-${i}`}>
                          <p className="text-sm text-gray-300">{n.store_address ? shortAddr(n.store_address) : ''}{n.store_address && n.reason ? <span className="text-gray-500"> — </span> : ''}<span className="text-amber-400/70">{n.reason}</span></p>
                        </div>
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

        {/* ── WEEKLY ── */}
        {tab === 'week' && (
          <div>
            <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 mb-4">
              <button onClick={() => setWeekStart(addWeeks(weekStart, -1))} className="text-gray-400 hover:text-white p-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <div className="text-center">
                <p className="text-sm font-semibold text-white">{weekLabel}</p>
                {isCurrentWeek && <p className="text-[10px] text-violet-400 font-semibold">CURRENT WEEK</p>}
              </div>
              <button onClick={() => setWeekStart(addWeeks(weekStart, 1))} className="text-gray-400 hover:text-white p-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
            {!isCurrentWeek && (
              <button onClick={() => setWeekStart(getMonday(new Date()))} className="w-full text-xs text-violet-400 hover:text-violet-300 font-semibold py-2 bg-gray-900 border border-gray-800 rounded-xl mb-4">Jump to Current Week</button>
            )}
            {dmSchedules.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                <button onClick={() => { setFilterDmId(''); setExpandedDm(null) }} className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${!filterDmId ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>All DMs</button>
                {dmSchedules.map(dm => (
                  <button key={dm.dm_id} onClick={() => { setFilterDmId(f => f === dm.dm_id ? '' : dm.dm_id); setExpandedDm(dm.dm_id) }}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${filterDmId === dm.dm_id ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{dm.dm_name.split(' ')[0]}</button>
                ))}
              </div>
            )}
            {weekLoading ? <div className="text-center text-gray-500 py-10 text-sm">Loading...</div> : (
              <div className="space-y-3">
                {dmSchedules.length === 0 && <p className="text-gray-500 text-sm text-center py-8">No DM schedules found for this week.</p>}
                {dmSchedules.map(dm => {
                  const isExp = expandedDm === dm.dm_id || filterDmId === dm.dm_id || dmSchedules.length === 1
                  const totalStores = dm.days.reduce((s, d) => s + d.shifts.length, 0)
                  const workDays = dm.days.filter(d => d.working).length
                  return (
                    <div key={dm.dm_id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                      <button onClick={() => setExpandedDm(expandedDm === dm.dm_id ? null : dm.dm_id)} className="w-full px-4 py-3 flex items-center justify-between text-left">
                        <div>
                          <p className="text-sm font-semibold text-white">{dm.dm_name}</p>
                          <p className="text-xs text-gray-500">
                            {workDays} day{workDays !== 1 ? 's' : ''} · {totalStores} store{totalStores !== 1 ? 's' : ''}
                            {!dm.has_shifts && !dm.has_notes && <span className="text-amber-400 ml-1">· No schedule submitted</span>}
                          </p>
                        </div>
                        <svg className={`w-4 h-4 text-gray-500 transition-transform ${isExp ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      {isExp && (
                        <div className="border-t border-gray-800/50">
                          {dm.days.map((day, i) => {
                            const isToday = day.date === new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
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
                                          <div key={si} className="mb-1">
                                            <p className="text-sm text-gray-300" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{shortAddr(s.store_address)}{s.role_note ? <span className="text-gray-500"> — {s.role_note}</span> : ''}</p>
                                          </div>
                                        ))}
                                        {day.visit_notes.filter(n => n.reason || n.store_address).map((n, ni) => (
                                          <div key={`vn-${ni}`} className="mb-1">
                                            <p className="text-sm text-gray-300" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{n.store_address ? shortAddr(n.store_address) : ''}{n.store_address && n.reason ? <span className="text-gray-500"> — </span> : ''}{n.reason && <span className="text-amber-400/70">{n.reason}</span>}</p>
                                          </div>
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
          </div>
        )}
      </div>
    </div>
  )
}
