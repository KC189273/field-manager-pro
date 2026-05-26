'use client'

import { useState, useEffect, useCallback } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface CalEvent {
  id: string
  title: string
  category: string
  start_date: string
  start_time: string | null
  end_date: string
  end_time: string | null
  notes: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
}

const CATEGORIES = [
  { key: 'travel',      label: 'Travel',      bg: 'bg-blue-600',   text: 'text-white', dot: 'bg-blue-500',   ring: 'border-blue-500'   },
  { key: 'meeting',     label: 'Meeting',     bg: 'bg-violet-600', text: 'text-white', dot: 'bg-violet-500', ring: 'border-violet-500' },
  { key: 'store_visit', label: 'Store Visit', bg: 'bg-green-600',  text: 'text-white', dot: 'bg-green-500',  ring: 'border-green-500'  },
  { key: 'blocked',     label: 'Blocked',     bg: 'bg-red-600',    text: 'text-white', dot: 'bg-red-500',    ring: 'border-red-500'    },
  { key: 'other',       label: 'Other',       bg: 'bg-gray-600',   text: 'text-white', dot: 'bg-gray-500',   ring: 'border-gray-500'   },
]

function getCat(key: string) {
  return CATEGORIES.find(c => c.key === key) ?? CATEGORIES[4]
}

function fmtTime(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function fmtShortDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_HEADERS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const ALLOWED = ['sales_director', 'owner', 'developer']

export default function CalendarPage() {
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

  const [session, setSession]     = useState<Session | null>(null)
  const [year, setYear]           = useState(today.getFullYear())
  const [month, setMonth]         = useState(today.getMonth() + 1) // 1-12
  const [events, setEvents]       = useState<CalEvent[]>([])
  const [loading, setLoading]     = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  // Modal
  const [modal, setModal]             = useState<'add' | 'edit' | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null)
  const [form, setForm] = useState({
    title: '', category: 'travel',
    startDate: '', startTime: '',
    endDate: '',  endTime: '',
    notes: '',
  })
  const [saving, setSaving]     = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [modalError, setModalError] = useState('')

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
  }, [])

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/calendar?year=${year}&month=${month}`)
      if (res.ok) {
        const d = await res.json()
        setEvents(d.events ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => {
    if (session && ALLOWED.includes(session.role)) loadEvents()
  }, [session, loadEvents])

  function prevMonth() {
    setSelectedDay(null)
    if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    setSelectedDay(null)
    if (month === 12) { setYear(y => y + 1); setMonth(1) } else setMonth(m => m + 1)
  }
  function goToday() {
    setYear(today.getFullYear()); setMonth(today.getMonth() + 1); setSelectedDay(todayStr)
  }

  function openAdd(dateStr: string) {
    setEditingEvent(null)
    setModalError('')
    setForm({ title: '', category: 'travel', startDate: dateStr, startTime: '', endDate: dateStr, endTime: '', notes: '' })
    setModal('add')
  }

  function openEdit(ev: CalEvent) {
    setEditingEvent(ev)
    setModalError('')
    setForm({
      title:     ev.title,
      category:  ev.category,
      startDate: ev.start_date,
      startTime: ev.start_time?.slice(0, 5) ?? '',
      endDate:   ev.end_date,
      endTime:   ev.end_time?.slice(0, 5) ?? '',
      notes:     ev.notes ?? '',
    })
    setModal('edit')
  }

  async function saveEvent() {
    setModalError('')
    if (!form.title.trim())  { setModalError('Please enter a title.'); return }
    if (!form.startDate)     { setModalError('Please set a start date.'); return }
    if (!form.endDate)       { setModalError('Please set an end date.'); return }
    if (form.endDate < form.startDate) { setModalError('End date must be on or after start date.'); return }

    setSaving(true)
    try {
      const payload = {
        title:     form.title.trim(),
        category:  form.category,
        startDate: form.startDate,
        startTime: form.startTime || null,
        endDate:   form.endDate,
        endTime:   form.endTime || null,
        notes:     form.notes.trim() || null,
        ...(modal === 'edit' ? { id: editingEvent?.id } : {}),
      }
      const res = await fetch('/api/calendar', {
        method: modal === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setModalError(d.error ?? 'Save failed. Please try again.')
        return
      }
      setModal(null)
      await loadEvents()
    } catch {
      setModalError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteEvent() {
    if (!editingEvent) return
    setDeleting(true)
    try {
      const res = await fetch('/api/calendar', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingEvent.id }),
      })
      if (!res.ok) { alert('Failed to delete event.'); return }
      setModal(null)
      await loadEvents()
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />
  if (!ALLOWED.includes(session.role)) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Access denied.</p>
      </div>
    )
  }

  // ── Build calendar grid (42 cells = 6 rows × 7 cols, Sun–Sat) ──
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay()
  const daysInMonth    = new Date(year, month, 0).getDate()
  const daysInPrevMonth = new Date(year, month - 1, 0).getDate()

  const cells: { dateStr: string; dayNum: number; isCurrent: boolean }[] = []

  for (let i = 0; i < firstDayOfWeek; i++) {
    const d = daysInPrevMonth - firstDayOfWeek + 1 + i
    const pm = month === 1 ? 12 : month - 1
    const py = month === 1 ? year - 1 : year
    cells.push({ dateStr: `${py}-${String(pm).padStart(2,'0')}-${String(d).padStart(2,'0')}`, dayNum: d, isCurrent: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ dateStr: `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`, dayNum: d, isCurrent: true })
  }
  const nm = month === 12 ? 1 : month + 1
  const ny = month === 12 ? year + 1 : year
  for (let d = 1; cells.length < 42; d++) {
    cells.push({ dateStr: `${ny}-${String(nm).padStart(2,'0')}-${String(d).padStart(2,'0')}`, dayNum: d, isCurrent: false })
  }

  function eventsOnDate(dateStr: string): CalEvent[] {
    return events.filter(ev => ev.start_date <= dateStr && ev.end_date >= dateStr)
  }

  const selectedDayEvents = selectedDay ? eventsOnDate(selectedDay) : []
  const isCurrentViewMonth = year === today.getFullYear() && month === today.getMonth() + 1

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-3 sm:px-8 pt-5 max-w-6xl mx-auto">

        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4 gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={prevMonth}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="text-center min-w-[140px] sm:min-w-[200px]">
              <h1 className="text-lg sm:text-2xl font-bold text-white">{MONTH_NAMES[month - 1]} {year}</h1>
              {!isCurrentViewMonth && (
                <button onClick={goToday} className="text-xs text-violet-400 hover:text-violet-300 transition-colors">
                  Today
                </button>
              )}
            </div>

            <button
              onClick={nextMonth}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <button
            onClick={() => openAdd(todayStr)}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors shrink-0"
          >
            <span className="text-lg leading-none">+</span>
            <span className="hidden sm:inline">Add Event</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>

        {/* Category legend */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {CATEGORIES.map(c => (
            <span key={c.key} className={`text-[10px] sm:text-xs font-bold px-2.5 sm:px-3 py-1 rounded-full ${c.bg} ${c.text}`}>
              {c.label}
            </span>
          ))}
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAY_HEADERS.map(d => (
            <div key={d} className="text-center text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider py-1 sm:py-2">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        {loading ? (
          <div className="text-center text-gray-500 py-20 text-sm">Loading…</div>
        ) : (
          <div className="grid grid-cols-7 gap-px bg-gray-800 rounded-2xl overflow-hidden border border-gray-800">
            {cells.map((cell, i) => {
              const dayEvts  = eventsOnDate(cell.dateStr)
              const isToday  = cell.dateStr === todayStr
              const isSel    = cell.dateStr === selectedDay
              const maxShow  = 3
              const overflow = dayEvts.length - maxShow

              return (
                <div
                  key={i}
                  onClick={() => setSelectedDay(cell.dateStr === selectedDay ? null : cell.dateStr)}
                  className={`min-h-[68px] sm:min-h-[130px] p-1 sm:p-2 cursor-pointer transition-colors select-none ${
                    isSel      ? 'bg-violet-950/70' :
                    isToday    ? 'bg-violet-950/30' :
                    cell.isCurrent ? 'bg-gray-900 hover:bg-gray-800/70' :
                                 'bg-gray-900/40 hover:bg-gray-800/40'
                  }`}
                >
                  {/* Date number */}
                  <div className={`text-[11px] sm:text-sm font-bold w-5 h-5 sm:w-7 sm:h-7 flex items-center justify-center rounded-full mb-0.5 ${
                    isToday    ? 'bg-violet-600 text-white' :
                    cell.isCurrent ? 'text-gray-300' :
                                 'text-gray-700'
                  }`}>
                    {cell.dayNum}
                  </div>

                  {/* Events */}
                  <div className="space-y-px">
                    {dayEvts.slice(0, maxShow).map(ev => {
                      const cat = getCat(ev.category)
                      return (
                        <div
                          key={ev.id}
                          onClick={e => { e.stopPropagation(); openEdit(ev) }}
                          className={`text-[9px] sm:text-xs font-semibold px-1 sm:px-2 py-px sm:py-0.5 rounded truncate leading-tight ${cat.bg} ${cat.text} cursor-pointer`}
                        >
                          {ev.title}
                        </div>
                      )
                    })}
                    {overflow > 0 && (
                      <div className="text-[9px] sm:text-xs text-gray-500 pl-0.5">+{overflow} more</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Day detail panel */}
        {selectedDay && (
          <div className="mt-3 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div>
                <p className="text-sm font-semibold text-white">
                  {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {selectedDayEvents.length === 0 ? 'No events' : `${selectedDayEvents.length} event${selectedDayEvents.length > 1 ? 's' : ''}`}
                </p>
              </div>
              <button
                onClick={() => openAdd(selectedDay)}
                className="text-xs text-violet-400 hover:text-violet-300 font-semibold transition-colors border border-violet-800/50 hover:border-violet-600 px-3 py-1.5 rounded-lg"
              >
                + Add Event
              </button>
            </div>

            {selectedDayEvents.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-gray-600">Nothing scheduled</p>
                <button
                  onClick={() => openAdd(selectedDay)}
                  className="mt-2 text-xs text-violet-400 hover:text-violet-300 font-medium"
                >
                  + Add an event
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-800/60">
                {selectedDayEvents.map(ev => {
                  const cat = getCat(ev.category)
                  const multiDay = ev.start_date !== ev.end_date
                  return (
                    <div
                      key={ev.id}
                      onClick={() => openEdit(ev)}
                      className="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-800/40 transition-colors"
                    >
                      <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${cat.dot}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white">{ev.title}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cat.bg} ${cat.text}`}>
                            {cat.label}
                          </span>
                          {(ev.start_time || ev.end_time) && (
                            <span className="text-xs text-gray-400">
                              {fmtTime(ev.start_time)}{ev.end_time ? ` – ${fmtTime(ev.end_time)}` : ''}
                            </span>
                          )}
                          {multiDay && (
                            <span className="text-xs text-gray-500">
                              {fmtShortDate(ev.start_date)} – {fmtShortDate(ev.end_date)}
                            </span>
                          )}
                        </div>
                        {ev.notes && (
                          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{ev.notes}</p>
                        )}
                        {ev.created_by_name && (
                          <p className="text-[10px] text-gray-600 mt-1">Added by {ev.created_by_name}</p>
                        )}
                      </div>
                      <svg className="w-4 h-4 text-gray-600 shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Add / Edit Modal ── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg border border-gray-800 p-6 max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-white mb-5">
              {modal === 'edit' ? 'Edit Event' : 'New Event'}
            </h2>

            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Title</label>
                <input
                  type="text"
                  placeholder="e.g. Chicago travel — store visits"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
                  autoFocus
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Category</label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map(c => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, category: c.key }))}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                        form.category === c.key
                          ? `${c.bg} ${c.text} ${c.ring}`
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Start date + time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Start Date</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={e => setForm(f => ({
                      ...f,
                      startDate: e.target.value,
                      endDate: f.endDate < e.target.value ? e.target.value : f.endDate,
                    }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Start Time</label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              {/* End date + time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">End Date</label>
                  <input
                    type="date"
                    value={form.endDate}
                    min={form.startDate}
                    onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">End Time</label>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Notes <span className="text-gray-600 font-normal">— optional</span></label>
                <textarea
                  rows={2}
                  placeholder="Additional details…"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none"
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
                    onClick={deleteEvent}
                    disabled={deleting || saving}
                    className="px-4 py-3 rounded-xl bg-red-600/20 hover:bg-red-600/40 disabled:opacity-50 text-red-400 font-medium text-sm transition-colors border border-red-600/30"
                  >
                    {deleting ? '…' : 'Delete'}
                  </button>
                )}
                <button
                  onClick={() => setModal(null)}
                  className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEvent}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                >
                  {saving ? 'Saving…' : modal === 'edit' ? 'Save Changes' : 'Add Event'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
