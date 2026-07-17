'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import NavBar from '@/components/NavBar'

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g
function Linkified({ text, className }: { text: string; className?: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  URL_REGEX.lastIndex = 0
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const url = match[0]
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className="text-violet-400 underline underline-offset-2 break-all"
      >
        {url}
      </a>
    )
    last = match.index + url.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <p className={className}>{parts}</p>
}

type Role = 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'

interface Session {
  id: string
  fullName: string
  role: Role
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
  all_day: boolean
  location: string | null
  recurrence: string
  recurrence_id: string | null
  exception_date: string | null
  task_id: string | null
  calendar_owner_id: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  attendees: { user_id: string; full_name: string; status: string }[]
  attachments: { id: string; s3_key: string; filename: string; content_type: string | null }[]
}

interface TeamMember {
  id: string
  full_name: string
  role: string
}

const CATEGORIES = [
  { key: 'travel',      label: 'Travel',      bg: 'bg-blue-600',    dot: 'bg-blue-500'   },
  { key: 'meeting',     label: 'Meeting',     bg: 'bg-violet-600',  dot: 'bg-violet-500' },
  { key: 'store_visit', label: 'Store Visit', bg: 'bg-green-600',   dot: 'bg-green-500'  },
  { key: 'blocked',     label: 'Blocked',     bg: 'bg-red-600',     dot: 'bg-red-500'    },
  { key: 'other',       label: 'Other',       bg: 'bg-gray-600',    dot: 'bg-gray-500'   },
]

const RECURRENCE_OPTS = [
  { key: 'none',      label: 'Does not repeat' },
  { key: 'daily',     label: 'Daily'           },
  { key: 'weekly',    label: 'Weekly'          },
  { key: 'biweekly',  label: 'Every 2 weeks'   },
  { key: 'monthly',   label: 'Monthly'         },
]

const REMINDER_OPTS = [
  { value: 15,   label: '15 minutes before' },
  { value: 60,   label: '1 hour before'     },
  { value: 1440, label: '1 day before'      },
]

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']
const DAY_HEADERS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const HAS_OWN_CALENDAR: Role[] = ['manager', 'sales_director']
const CAN_VIEW_TEAM: Role[]    = ['ops_manager', 'owner', 'developer', 'sales_director']

function getCat(key: string) {
  return CATEGORIES.find(c => c.key === key) ?? CATEGORIES[4]
}

function fmtTime(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function fmtShortDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function todayStr() {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`
}

const RSVP_LABELS: Record<string, string> = {
  invited: 'Invited', accepted: 'Accepted', declined: 'Declined', maybe: 'Maybe',
}
const RSVP_COLORS: Record<string, string> = {
  invited: 'text-yellow-400', accepted: 'text-green-400', declined: 'text-red-400', maybe: 'text-gray-400',
}

export default function CalendarPage() {
  const today = new Date()
  const [session, setSession]       = useState<Session | null>(null)
  const [activeTab, setActiveTab]   = useState<'my' | 'team'>('my')
  const [year, setYear]             = useState(today.getFullYear())
  const [month, setMonth]           = useState(today.getMonth() + 1)
  const [events, setEvents]             = useState<CalEvent[]>([])
  const [declinedEvents, setDeclinedEvents] = useState<CalEvent[]>([])
  const [loading, setLoading]           = useState(true)
  const [selectedDay, setSelectedDay]   = useState<string | null>(null)
  const [showDeclined, setShowDeclined] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('')
  const [stores, setStores] = useState<{ id: string; address: string }[]>([])

  // Modal
  const [modal, setModal]               = useState<'add' | 'edit' | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null)
  const [saving, setSaving]             = useState(false)
  const [deleting, setDeleting]         = useState(false)
  const [modalError, setModalError]     = useState('')
  const [scopePicker, setScopePicker]   = useState<{ action: 'edit' | 'delete'; event: CalEvent } | null>(null)
  const [editScope, setEditScope]       = useState<'this' | 'all'>('all')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)

  const [form, setForm] = useState({
    title: '', category: 'travel',
    startDate: '', startTime: '',
    endDate: '',  endTime: '',
    allDay: false,
    location: '', notes: '',
    recurrence: 'none',
    reminderMinutes: [] as number[],
    attendeeIds: [] as string[],
    attachments: [] as { id?: string; key: string; filename: string; content_type: string | null }[],
  })

  // ── Session ──
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      setSession(d)
      // Ops+/owner/dev land on team tab by default (no personal calendar)
      if (!HAS_OWN_CALENDAR.includes(d.role) && CAN_VIEW_TEAM.includes(d.role)) {
        setActiveTab('team')
      }
    })
  }, [])

  // ── Team members ──
  useEffect(() => {
    if (!session || !CAN_VIEW_TEAM.includes(session.role)) return
    fetch('/api/calendar/team-members')
      .then(r => r.json())
      .then(d => { setTeamMembers(d.members ?? []) })
  }, [session])

  // ── Load events ──
  const loadEvents = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const ownerParam = (activeTab === 'team' && selectedOwnerId)
        ? `&ownerId=${selectedOwnerId}`
        : ''
      const res = await fetch(`/api/calendar?year=${year}&month=${month}${ownerParam}`)
      if (res.ok) {
        const d = await res.json()
        setEvents(d.events ?? [])
        setDeclinedEvents(d.declinedEvents ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [session, year, month, activeTab, selectedOwnerId])

  useEffect(() => {
    if (session) loadEvents()
  }, [session, loadEvents])

  // ── Month nav ──
  function prevMonth() {
    setSelectedDay(null)
    if (month === 1) { setYear(y => y-1); setMonth(12) } else setMonth(m => m-1)
  }
  function nextMonth() {
    setSelectedDay(null)
    if (month === 12) { setYear(y => y+1); setMonth(1) } else setMonth(m => m+1)
  }
  function goToday() {
    setYear(today.getFullYear()); setMonth(today.getMonth()+1); setSelectedDay(todayStr())
  }

  // ── Stores for location picker ──
  function fetchStores(managerId: string) {
    fetch(`/api/calendar/stores?managerId=${managerId}`)
      .then(r => r.json())
      .then(d => setStores(d.stores ?? []))
      .catch(() => setStores([]))
  }

  // Determines which DM's stores to load for the modal
  function loadStoresForModal(ownerRole?: string, ownerId?: string) {
    const id = ownerId ?? session?.id
    // Only DMs (managers) have assigned stores
    const role = ownerRole ??
      (ownerId ? teamMembers.find(m => m.id === ownerId)?.role : session?.role)
    if (role === 'manager' && id) {
      fetchStores(id)
    } else {
      setStores([])
    }
  }

  // ── Modal helpers ──
  function openAdd(dateStr: string) {
    setEditingEvent(null)
    setModalError('')
    setForm({
      title: '', category: 'travel',
      startDate: dateStr, startTime: '',
      endDate: dateStr,   endTime: '',
      allDay: false, location: '', notes: '',
      recurrence: 'none', reminderMinutes: [], attendeeIds: [], attachments: [],
    })
    const ownerId = (activeTab === 'team' && selectedOwnerId) ? selectedOwnerId : undefined
    loadStoresForModal(undefined, ownerId)
    setModal('add')
  }

  function openEdit(ev: CalEvent, scope: 'this' | 'all' = 'all') {
    setEditScope(scope)
    setEditingEvent(ev)
    setModalError('')
    setForm({
      title:     ev.title,
      category:  ev.category,
      startDate: ev.start_date,
      startTime: ev.start_time?.slice(0, 5) ?? '',
      endDate:   ev.end_date,
      endTime:   ev.end_time?.slice(0, 5) ?? '',
      allDay:    ev.all_day,
      location:  ev.location ?? '',
      notes:     ev.notes ?? '',
      recurrence: ev.recurrence,
      reminderMinutes: [],
      attendeeIds: ev.attendees?.map(a => a.user_id) ?? [],
      attachments: ev.attachments?.map(a => ({ id: a.id, key: a.s3_key, filename: a.filename, content_type: a.content_type })) ?? [],
    })
    loadStoresForModal(undefined, ev.calendar_owner_id ?? undefined)
    setModal('edit')
  }

  // ── Attachment upload ──
  async function handleAttachmentFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAttachment(true)
    try {
      const res = await fetch('/api/calendar/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      })
      const { url, key } = await res.json()
      await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      setForm(f => ({
        ...f,
        attachments: [...f.attachments, { key, filename: file.name, content_type: file.type }],
      }))
    } catch {
      setModalError('Attachment upload failed. Please try again.')
    } finally {
      setUploadingAttachment(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function removeAttachment(idx: number) {
    const att = form.attachments[idx]
    // If saved (has id), delete from DB
    if (att.id && editingEvent) {
      await fetch('/api/calendar/attachment-url', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: att.id }),
      })
    }
    setForm(f => ({ ...f, attachments: f.attachments.filter((_, i) => i !== idx) }))
  }

  async function openAttachment(att: { id?: string; key: string; filename: string }) {
    if (!att.id) return
    const res = await fetch(`/api/calendar/attachment-url?id=${att.id}`)
    const { url } = await res.json()
    window.open(url, '_blank')
  }

  // ── Conflict detection ──
  function hasConflicts(): boolean {
    if (!form.startDate || !form.allDay === false && !form.startTime) return false
    return events.some(ev => {
      if (editingEvent && ev.id === editingEvent.id) return false
      if (ev.all_day || form.allDay) return false
      if (!ev.start_time || !ev.end_time || !form.startTime || !form.endTime) return false
      const evStart  = ev.start_date + 'T' + ev.start_time
      const evEnd    = ev.end_date   + 'T' + ev.end_time
      const newStart = form.startDate + 'T' + form.startTime
      const newEnd   = form.endDate   + 'T' + (form.endTime || form.startTime)
      return newStart < evEnd && newEnd > evStart
    })
  }

  // ── Save event ──
  async function saveEvent() {
    setModalError('')
    if (!form.title.trim())  { setModalError('Please enter a title.'); return }
    if (!form.startDate)     { setModalError('Please set a start date.'); return }
    if (!form.endDate)       { setModalError('Please set an end date.'); return }
    if (form.endDate < form.startDate) { setModalError('End date must be on or after start date.'); return }

    setSaving(true)
    try {
      // Determine ownerId for API
      const ownerId = (activeTab === 'team' && selectedOwnerId) ? selectedOwnerId : undefined

      const payload: Record<string, unknown> = {
        title:          form.title.trim(),
        category:       form.category,
        startDate:      form.startDate,
        startTime:      form.allDay ? null : (form.startTime || null),
        endDate:        form.endDate,
        endTime:        form.allDay ? null : (form.endTime || null),
        allDay:         form.allDay,
        location:       form.location.trim() || null,
        notes:          form.notes.trim() || null,
        recurrence:     form.recurrence,
        attendeeIds:    form.attendeeIds,
        reminderMinutes: form.reminderMinutes,
        ...(ownerId ? { ownerId } : {}),
        ...(modal === 'edit' ? { id: editingEvent?.id } : {}),
        ...(modal === 'edit' && editScope === 'this' && editingEvent && editingEvent.recurrence !== 'none' && !editingEvent.exception_date
          ? { editScope: 'this', instanceDate: editingEvent.start_date }
          : {}),
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

      // Save new attachments to DB
      if (modal === 'add') {
        const { id: newEventId } = await res.json()
        for (const att of form.attachments) {
          if (!att.id) {
            await fetch('/api/calendar/attachment-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ eventId: newEventId, key: att.key, filename: att.filename, contentType: att.content_type }),
            })
          }
        }
      }

      setModal(null)
      await loadEvents()
    } catch {
      setModalError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete event ──
  async function deleteEvent() {
    if (!editingEvent) return
    // Recurring series events: ask which scope to delete
    if (editingEvent.recurrence !== 'none' && !editingEvent.exception_date) {
      setScopePicker({ action: 'delete', event: editingEvent })
      return
    }
    await doDeleteWithScope('all')
  }

  async function doDeleteWithScope(scope: 'this' | 'all') {
    if (!editingEvent) return
    setDeleting(true)
    setScopePicker(null)
    try {
      const res = await fetch('/api/calendar', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingEvent.id,
          ...(scope === 'this' ? { deleteScope: 'this', instanceDate: editingEvent.start_date } : {}),
        }),
      })
      if (!res.ok) { setModalError('Failed to delete event.'); return }
      setModal(null)
      await loadEvents()
    } catch {
      setModalError('Network error. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  function onScopeChosen(scope: 'this' | 'all') {
    if (!scopePicker) return
    const ev = scopePicker.event
    setScopePicker(null)
    if (scopePicker.action === 'delete') {
      doDeleteWithScope(scope)
    } else {
      openEdit(ev, scope)
    }
  }

  // ── RSVP ──
  async function updateRsvp(eventId: string, status: string) {
    await fetch('/api/calendar/rsvp', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, status }),
    })
    await loadEvents()
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />

  const canViewTeam    = CAN_VIEW_TEAM.includes(session.role)
  const hasOwnCalendar = HAS_OWN_CALENDAR.includes(session.role)
  const canEdit        = (ev: CalEvent) =>
    ev.calendar_owner_id === session.id ||
    ev.created_by === session.id ||
    canViewTeam

  // Returns this user's RSVP status if they're an invited attendee (not the calendar owner)
  const myRsvpStatus = (ev: CalEvent): string | null => {
    if (ev.calendar_owner_id === session.id) return null
    return ev.attendees?.find(a => a.user_id === session.id)?.status ?? null
  }

  // ── Calendar grid ──
  const firstDayOfWeek  = new Date(year, month-1, 1).getDay()
  const daysInMonth     = new Date(year, month, 0).getDate()
  const daysInPrevMonth = new Date(year, month-1, 0).getDate()

  const cells: { dateStr: string; dayNum: number; isCurrent: boolean }[] = []
  for (let i = 0; i < firstDayOfWeek; i++) {
    const d  = daysInPrevMonth - firstDayOfWeek + 1 + i
    const pm = month === 1 ? 12 : month-1
    const py = month === 1 ? year-1 : year
    cells.push({ dateStr: `${py}-${String(pm).padStart(2,'0')}-${String(d).padStart(2,'0')}`, dayNum: d, isCurrent: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ dateStr: `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`, dayNum: d, isCurrent: true })
  }
  const nm = month === 12 ? 1 : month+1
  const ny = month === 12 ? year+1 : year
  for (let d = 1; cells.length < 42; d++) {
    cells.push({ dateStr: `${ny}-${String(nm).padStart(2,'0')}-${String(d).padStart(2,'0')}`, dayNum: d, isCurrent: false })
  }

  function eventsOnDate(dateStr: string) {
    return events.filter(ev => ev.start_date <= dateStr && ev.end_date >= dateStr)
  }

  const today2 = todayStr()
  const selectedDayEvents = selectedDay ? eventsOnDate(selectedDay) : []

  // ── Attendee options (all DMs/SDs except self) ──
  const attendeeOptions = teamMembers.filter(m => m.id !== session.id)

  const showTeamNotSelected = activeTab === 'team' && canViewTeam && !selectedOwnerId

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-3 sm:px-6 pt-4 max-w-4xl mx-auto">

        {/* ── Tab navigation ── */}
        {hasOwnCalendar && canViewTeam && (
          <div className="flex bg-gray-900 rounded-2xl p-1 mb-4 gap-1">
            <button
              onClick={() => { setActiveTab('my'); setSelectedDay(null) }}
              className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-colors ${
                activeTab === 'my' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              My Calendar
            </button>
            <button
              onClick={() => { setActiveTab('team'); setSelectedDay(null) }}
              className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-colors ${
                activeTab === 'team' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              My Team&apos;s Calendars
            </button>
          </div>
        )}

        {/* ── Team header (no own calendar — ops+/owner/dev) ── */}
        {!hasOwnCalendar && canViewTeam && (
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-gray-400 mb-2 uppercase tracking-wide">My Team&apos;s Calendars</h2>
          </div>
        )}

        {/* ── Team member selector ── */}
        {activeTab === 'team' && canViewTeam && (
          <div className="mb-4">
            <select
              value={selectedOwnerId}
              onChange={e => { setSelectedOwnerId(e.target.value); setSelectedDay(null) }}
              className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-2xl px-4 py-3 focus:outline-none focus:border-violet-500"
            >
              <option value="">Select a team member&apos;s calendar…</option>
              {teamMembers.map(m => (
                <option key={m.id} value={m.id}>{m.full_name} ({m.role === 'manager' ? 'DM' : 'Sales Director'})</option>
              ))}
            </select>
          </div>
        )}

        {showTeamNotSelected ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <svg className="w-10 h-10 text-gray-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-gray-500 text-sm">Select a team member above to view their calendar</p>
          </div>
        ) : (
          <>
            {/* ── Month nav + Add button ── */}
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="flex items-center gap-1">
                <button onClick={prevMonth} className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
                </button>
                <div className="text-center min-w-[150px]">
                  <h1 className="text-lg font-bold text-white">{MONTH_NAMES[month-1]} {year}</h1>
                  {!(year === today.getFullYear() && month === today.getMonth()+1) && (
                    <button onClick={goToday} className="text-xs text-violet-400 hover:text-violet-300">Today</button>
                  )}
                </div>
                <button onClick={nextMonth} className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                </button>
              </div>
              {/* Add button: show for own calendar OR team view with selection + elevated role */}
              {(activeTab === 'my' || (activeTab === 'team' && selectedOwnerId && canViewTeam)) && (
                <button
                  onClick={() => openAdd(today2)}
                  className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors shrink-0"
                >
                  <span className="text-lg leading-none">+</span>
                  <span>Add Event</span>
                </button>
              )}
            </div>

            {/* ── Category legend ── */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {CATEGORIES.map(c => (
                <span key={c.key} className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${c.bg} text-white`}>{c.label}</span>
              ))}
            </div>

            {/* ── Day headers ── */}
            <div className="grid grid-cols-7 mb-1">
              {DAY_HEADERS.map(d => (
                <div key={d} className="text-center text-[10px] font-semibold text-gray-600 uppercase tracking-wider py-1">{d}</div>
              ))}
            </div>

            {/* ── Calendar grid ── */}
            {loading ? (
              <div className="grid grid-cols-7 gap-px bg-gray-800 rounded-2xl overflow-hidden border border-gray-800">
                {Array.from({ length: 42 }).map((_, i) => (
                  <div key={i} className="min-h-[68px] bg-gray-900 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-px bg-gray-800 rounded-2xl overflow-hidden border border-gray-800">
                {cells.map((cell, i) => {
                  const dayEvts  = eventsOnDate(cell.dateStr)
                  const isToday  = cell.dateStr === today2
                  const isSel    = cell.dateStr === selectedDay
                  const overflow = dayEvts.length - 3

                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedDay(cell.dateStr === selectedDay ? null : cell.dateStr)}
                      className={`min-h-[68px] sm:min-h-[110px] p-1 sm:p-2 cursor-pointer transition-colors select-none ${
                        isSel       ? 'bg-violet-950/70' :
                        isToday     ? 'bg-violet-950/30' :
                        cell.isCurrent ? 'bg-gray-900 hover:bg-gray-800/70' :
                                     'bg-gray-900/40 hover:bg-gray-800/40'
                      }`}
                    >
                      <div className={`text-[11px] sm:text-sm font-bold w-5 h-5 sm:w-7 sm:h-7 flex items-center justify-center rounded-full mb-0.5 ${
                        isToday ? 'bg-violet-600 text-white' :
                        cell.isCurrent ? 'text-gray-300' : 'text-gray-700'
                      }`}>
                        {cell.dayNum}
                      </div>
                      <div className="space-y-px">
                        {dayEvts.slice(0, 3).map(ev => {
                          const cat    = getCat(ev.category)
                          const rsvp   = myRsvpStatus(ev)
                          const isPending = rsvp === 'invited' || rsvp === 'maybe'
                          return (
                            <div
                              key={ev.id + ev.start_date}
                              onClick={e => { e.stopPropagation(); if (ev.recurrence !== 'none' && !ev.exception_date) { setScopePicker({ action: 'edit', event: ev }) } else { openEdit(ev) } }}
                              className={`text-[9px] sm:text-[11px] font-semibold px-1 py-px rounded truncate leading-tight text-white cursor-pointer ${
                                isPending ? `${cat.bg} opacity-60 border border-dashed border-white/40` : cat.bg
                              }`}
                            >
                              {!ev.all_day && ev.start_time && (
                                <span className="opacity-80 mr-0.5">{fmtTime(ev.start_time).split(' ')[0]}</span>
                              )}
                              {ev.title}
                            </div>
                          )
                        })}
                        {overflow > 0 && (
                          <div className="text-[9px] text-gray-500 pl-0.5">+{overflow} more</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── Day detail panel ── */}
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
                  {(activeTab === 'my' || (activeTab === 'team' && selectedOwnerId && canViewTeam)) && (
                    <button
                      onClick={() => openAdd(selectedDay)}
                      className="text-xs text-violet-400 hover:text-violet-300 font-semibold border border-violet-800/50 hover:border-violet-600 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      + Add
                    </button>
                  )}
                </div>

                {selectedDayEvents.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-gray-600">Nothing scheduled</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-800/60">
                    {selectedDayEvents.map(ev => {
                      const cat      = getCat(ev.category)
                      const multiDay = ev.start_date !== ev.end_date
                      const myRsvp   = ev.attendees?.find(a => a.user_id === session.id)

                      return (
                        <div key={ev.id + ev.start_date} className="px-4 py-3.5">
                          <div
                            className="flex items-start gap-3 cursor-pointer"
                            onClick={() => { if (!canEdit(ev)) return; if (ev.recurrence !== 'none' && !ev.exception_date) { setScopePicker({ action: 'edit', event: ev }) } else { openEdit(ev) } }}
                          >
                            <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${cat.dot}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-white">{ev.title}</p>
                                {myRsvpStatus(ev) === 'invited' && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">Pending</span>
                                )}
                                {myRsvpStatus(ev) === 'maybe' && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400 border border-gray-500/30">Maybe</span>
                                )}
                                {myRsvpStatus(ev) === 'accepted' && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">Accepted</span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cat.bg} text-white`}>{cat.label}</span>
                                {ev.all_day ? (
                                  <span className="text-xs text-gray-500">All day</span>
                                ) : (ev.start_time || ev.end_time) ? (
                                  <span className="text-xs text-gray-400">
                                    {fmtTime(ev.start_time)}{ev.end_time ? ` – ${fmtTime(ev.end_time)}` : ''}
                                  </span>
                                ) : null}
                                {multiDay && (
                                  <span className="text-xs text-gray-500">{fmtShortDate(ev.start_date)} – {fmtShortDate(ev.end_date)}</span>
                                )}
                                {ev.recurrence !== 'none' && (
                                  <span className="text-[10px] text-violet-400 border border-violet-800/40 px-1.5 py-0.5 rounded-full">
                                    {RECURRENCE_OPTS.find(r => r.key === ev.recurrence)?.label ?? ev.recurrence}
                                  </span>
                                )}
                              </div>
                              {ev.location && <Linkified text={`📍 ${ev.location}`} className="text-xs text-gray-500 mt-1" />}
                              {ev.notes && <Linkified text={ev.notes} className="text-xs text-gray-500 mt-1 leading-relaxed" />}
                              {ev.created_by_name && ev.created_by !== session.id && (
                                <p className="text-[10px] text-gray-600 mt-1">Added by {ev.created_by_name}</p>
                              )}

                              {/* Attendees */}
                              {ev.attendees && ev.attendees.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                  {ev.attendees.map(a => (
                                    <span key={a.user_id} className={`text-[10px] font-medium ${RSVP_COLORS[a.status] ?? 'text-gray-400'}`}>
                                      {a.full_name} · {RSVP_LABELS[a.status] ?? a.status}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Attachments */}
                              {ev.attachments && ev.attachments.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {ev.attachments.map(att => (
                                    <button
                                      key={att.id}
                                      onClick={async e => { e.stopPropagation(); await openAttachment({ id: att.id, key: att.s3_key, filename: att.filename }) }}
                                      className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 transition-colors"
                                    >
                                      <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                      </svg>
                                      <span className="truncate max-w-[120px]">{att.filename}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            {canEdit(ev) && (
                              <svg className="w-4 h-4 text-gray-600 shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            )}
                          </div>

                          {/* RSVP buttons for invited attendee */}
                          {myRsvp && (
                            <div className="flex gap-2 mt-2 ml-5">
                              {(['accepted', 'maybe', 'declined'] as const).map(s => (
                                <button
                                  key={s}
                                  onClick={() => updateRsvp(ev.id, s)}
                                  className={`text-[11px] font-semibold px-3 py-1 rounded-lg border transition-colors ${
                                    myRsvp.status === s
                                      ? s === 'accepted' ? 'bg-green-600/30 border-green-500 text-green-300'
                                      : s === 'declined' ? 'bg-red-600/30 border-red-500 text-red-300'
                                      : 'bg-gray-600/30 border-gray-500 text-gray-300'
                                      : 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                                  }`}
                                >
                                  {s === 'accepted' ? 'Accept' : s === 'declined' ? 'Decline' : 'Maybe'}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          {/* ── Declined events audit trail ── */}
          {declinedEvents.length > 0 && activeTab === 'my' && (
            <div className="mt-4">
              <button
                onClick={() => setShowDeclined(v => !v)}
                className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors mb-2"
              >
                <svg className={`w-3.5 h-3.5 transition-transform ${showDeclined ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="font-medium uppercase tracking-wide">Declined Invites ({declinedEvents.length})</span>
              </button>

              {showDeclined && (
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-gray-800">
                    <p className="text-xs text-gray-500">Events you declined this month — kept for your records</p>
                  </div>
                  <div className="divide-y divide-gray-800/60">
                    {declinedEvents.map(ev => {
                      const cat = getCat(ev.category)
                      return (
                        <div key={ev.id} className="flex items-start gap-3 px-4 py-3 opacity-50">
                          <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${cat.dot}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm text-gray-400 line-through">{ev.title}</p>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25">Declined</span>
                            </div>
                            <p className="text-xs text-gray-600 mt-0.5">
                              {fmtShortDate(ev.start_date)}{ev.start_date !== ev.end_date ? ` – ${fmtShortDate(ev.end_date)}` : ''}
                              {ev.created_by_name ? ` · Organized by ${ev.created_by_name}` : ''}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
        )}
      </div>

      {/* ── Add / Edit Modal ── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg border border-gray-800 p-5 max-h-[94vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-white">
                {modal === 'edit' ? 'Edit Event' : 'New Event'}
                {activeTab === 'team' && selectedOwnerId && (
                  <span className="text-sm font-normal text-gray-500 ml-2">
                    for {teamMembers.find(m => m.id === selectedOwnerId)?.full_name}
                  </span>
                )}
              </h2>
              <button onClick={() => setModal(null)} className="text-gray-500 hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Chicago store visit"
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
                        form.category === c.key ? `${c.bg} text-white border-transparent` : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* All Day */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => setForm(f => ({ ...f, allDay: !f.allDay }))}
                  className={`w-11 h-6 rounded-full transition-colors ${form.allDay ? 'bg-violet-600' : 'bg-gray-700'} relative`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${form.allDay ? 'translate-x-6' : 'translate-x-1'}`} />
                </div>
                <span className="text-sm text-gray-300">All day</span>
              </label>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Start Date</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={e => setForm(f => ({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
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
              </div>

              {/* Times (hidden when allDay) */}
              {!form.allDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Start Time</label>
                    <input
                      type="time"
                      value={form.startTime}
                      onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
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
              )}

              {/* Location */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Location <span className="text-gray-600 font-normal">— optional</span></label>
                {stores.length > 0 && (
                  <select
                    value=""
                    onChange={e => { if (e.target.value) setForm(f => ({ ...f, location: e.target.value })) }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500 mb-2"
                  >
                    <option value="">Pick a store location…</option>
                    {stores.map(s => (
                      <option key={s.id} value={s.address}>{s.address}</option>
                    ))}
                  </select>
                )}
                <input
                  type="text"
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder={stores.length > 0 ? 'Or type a custom address…' : 'e.g. 123 Main St, Chicago'}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
                />
              </div>

              {/* Recurrence */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Repeat</label>
                <select
                  value={form.recurrence}
                  onChange={e => setForm(f => ({ ...f, recurrence: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500"
                >
                  {RECURRENCE_OPTS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </div>

              {/* Attendees (invite other DMs/SDs) */}
              {attendeeOptions.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Invite Attendees <span className="text-gray-600 font-normal">— optional</span></label>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {attendeeOptions.map(m => (
                      <label key={m.id} className="flex items-center gap-3 cursor-pointer py-1.5 px-3 rounded-xl hover:bg-gray-800 transition-colors">
                        <input
                          type="checkbox"
                          checked={form.attendeeIds.includes(m.id)}
                          onChange={e => setForm(f => ({
                            ...f,
                            attendeeIds: e.target.checked
                              ? [...f.attendeeIds, m.id]
                              : f.attendeeIds.filter(id => id !== m.id),
                          }))}
                          className="accent-violet-600 w-4 h-4"
                        />
                        <span className="text-sm text-gray-300">{m.full_name}</span>
                        <span className="text-xs text-gray-600">{m.role === 'manager' ? 'DM' : 'Sales Director'}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Reminders */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Reminders</label>
                <div className="flex flex-wrap gap-2">
                  {REMINDER_OPTS.map(r => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setForm(f => ({
                        ...f,
                        reminderMinutes: f.reminderMinutes.includes(r.value)
                          ? f.reminderMinutes.filter(v => v !== r.value)
                          : [...f.reminderMinutes, r.value],
                      }))}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                        form.reminderMinutes.includes(r.value)
                          ? 'bg-violet-600 text-white border-violet-500'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Notes <span className="text-gray-600 font-normal">— optional</span></label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Additional details…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none"
                />
              </div>

              {/* Attachments */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Attachments <span className="text-gray-600 font-normal">— optional</span></label>
                {/* input rendered as overlay on the button below — reliable on Android WebView */}
                {form.attachments.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {form.attachments.map((att, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2">
                        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        <span className="text-xs text-gray-300 flex-1 truncate">{att.filename}</span>
                        <button onClick={() => removeAttachment(idx)} className="text-gray-600 hover:text-red-400 transition-colors ml-1">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className={`relative flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-dashed border-gray-600 rounded-xl px-4 py-2.5 text-sm text-gray-400 hover:text-gray-200 transition-colors w-full justify-center ${uploadingAttachment ? 'opacity-50 pointer-events-none' : ''}`}>
                  <input ref={fileInputRef} type="file" onChange={handleAttachmentFile} disabled={uploadingAttachment} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                  {uploadingAttachment ? (
                    <span>Uploading…</span>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      Attach a file
                    </>
                  )}
                </div>
              </div>

              {/* Conflict warning */}
              {hasConflicts() && (
                <div className="rounded-xl bg-amber-900/30 border border-amber-600/40 px-4 py-3 text-sm text-amber-400">
                  ⚠ Potential time conflict with another event on this day.
                </div>
              )}

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
                  disabled={saving || uploadingAttachment}
                  className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
                >
                  {saving ? 'Saving…' : modal === 'edit' ? 'Save Changes' : 'Add Event'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Scope picker modal (recurring edit/delete) ── */}
      {scopePicker && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center"
          onClick={() => setScopePicker(null)}
        >
          <div
            className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-sm border border-gray-800 p-5"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-white mb-1">Recurring Event</h2>
            <p className="text-sm text-gray-400 mb-5">
              {scopePicker.action === 'edit' ? 'Which events do you want to edit?' : 'Which events do you want to delete?'}
            </p>
            <div className="space-y-2">
              <button
                onClick={() => onScopeChosen('this')}
                className="w-full py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm font-semibold text-white transition-colors text-left px-4"
              >
                This event only
              </button>
              <button
                onClick={() => onScopeChosen('all')}
                className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors text-left px-4 ${
                  scopePicker.action === 'delete'
                    ? 'bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-600/30'
                    : 'bg-gray-800 hover:bg-gray-700 text-white'
                }`}
              >
                All events in series
              </button>
              <button
                onClick={() => setScopePicker(null)}
                className="w-full py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
