'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import NavBar from '@/components/NavBar'

type Role = 'employee' | 'manager' | 'ops_field_leader' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'

interface Session { id: string; fullName: string; role: Role }

interface Employee {
  id: string; full_name: string; username: string; role: string
  manager_name: string | null; is_active: boolean; avatar_key: string | null
}

interface Shift {
  id: string; clock_in_at: string; clock_out_at: string | null
  clock_in_lat: string | null; clock_in_lng: string | null
  clock_out_lat: string | null; clock_out_lng: string | null
  clock_in_address: string | null; clock_out_address: string | null
  is_manual: boolean; manual_note: string | null; manual_by_name: string | null
  store_address: string | null; break_minutes: number; duration_hours: number
  geofence_override: boolean; clock_in_photo_key: string | null
}

interface ShiftEdit {
  shift_id: string; old_clock_in: string | null; new_clock_in: string | null
  old_clock_out: string | null; new_clock_out: string | null
  note: string | null; edited_by_name: string; edited_at: string
}

interface AccountabilityDoc {
  id: string; ref_number: string; level: string; title: string
  incident_date: string; notes: string; expectations: string
  status: string; ack_status: string; author_name: string
  approved_at: string | null; created_at: string
}

interface Flag {
  id: string; type: string; detail: string | null; date: string
  resolved: boolean; resolved_by_name: string | null; resolution_note: string | null
  created_at: string
}

interface Override {
  id: string; approved_by_name: string; store_address: string | null
  reason: string; reported_distance_ft: number | null; created_at: string
}

interface TimeOff {
  id: string; start_date: string; end_date: string; reason: string | null
  status: string; notes: string | null; approver_name: string | null
  partial_day: boolean; partial_start_time: string | null; partial_end_time: string | null
  created_at: string
}

interface Summary {
  totalShifts: number; totalHours: number; totalBreakMinutes: number
  manualEntries: number; editedShifts: number; gpsVerified: number
  flagCount: number; accountabilityCount: number; overrideCount: number
}

interface TimelineItem {
  date: string
  type: 'shift' | 'edit' | 'accountability' | 'flag' | 'override' | 'timeoff'
  data: Shift | ShiftEdit | AccountabilityDoc | Flag | Override | TimeOff
}

const CST = 'America/Chicago'

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: CST, hour: 'numeric', minute: '2-digit', hour12: true })
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: CST, weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtDateLong(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: CST, month: 'short', day: 'numeric', year: 'numeric' })
}

const FILTER_TYPES = ['All', 'Shifts', 'Edits', 'Accountability', 'Flags', 'Overrides', 'Time Off'] as const
type FilterType = typeof FILTER_TYPES[number]

const ALLOWED: Role[] = ['ops_manager', 'owner', 'sales_director', 'developer']

export default function EmployeeRecordPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [recordLoading, setRecordLoading] = useState(false)
  const [filter, setFilter] = useState<FilterType>('All')
  const [exporting, setExporting] = useState(false)
  const [expandedShifts, setExpandedShifts] = useState<Set<string>>(new Set())

  // Data
  const [employee, setEmployee] = useState<{ full_name: string; username: string; email: string; role: string; pay_type: string; manager_name: string | null; is_active: boolean; is_terminated: boolean } | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [edits, setEdits] = useState<ShiftEdit[]>([])
  const [accountability, setAccountability] = useState<AccountabilityDoc[]>([])
  const [flags, setFlags] = useState<Flag[]>([])
  const [overrides, setOverrides] = useState<Override[]>([])
  const [timeOff, setTimeOff] = useState<TimeOff[]>([])
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const searchParams = useSearchParams()

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(setSession)
    fetch('/api/employee-record').then(r => r.json()).then(d => {
      setEmployees(d.employees ?? [])
      if (d.currentPeriod) {
        setFrom(d.currentPeriod.start)
        setTo(d.currentPeriod.end)
      }
      setLoading(false)
      // Auto-select employee from URL param
      const urlId = searchParams.get('id')
      if (urlId && d.currentPeriod) {
        setSelectedId(urlId)
        setFilter('All')
        // loadRecord will be called after from/to are set
        setTimeout(() => loadRecord(urlId, d.currentPeriod.start, d.currentPeriod.end), 100)
      }
    }).catch(() => setLoading(false))
  }, [])

  async function loadRecord(empId: string, dateFrom?: string, dateTo?: string) {
    setRecordLoading(true)
    setMessage(null)
    const f = dateFrom || from
    const t = dateTo || to
    try {
      const res = await fetch(`/api/employee-record?employeeId=${empId}&from=${f}&to=${t}`)
      const d = await res.json()
      if (!res.ok) { setMessage({ text: d.error || 'Failed to load', type: 'error' }); return }
      setEmployee(d.employee)
      setSummary(d.summary)
      setShifts(d.shifts)
      setEdits(d.edits)
      setAccountability(d.accountability)
      setFlags(d.flags)
      setOverrides(d.overrides)
      setTimeOff(d.timeOff)
      setExpandedShifts(new Set())
    } catch {
      setMessage({ text: 'Network error', type: 'error' })
    } finally {
      setRecordLoading(false)
    }
  }

  function selectEmployee(empId: string) {
    setSelectedId(empId)
    setFilter('All')
    loadRecord(empId)
  }

  function changeDates() {
    if (selectedId) loadRecord(selectedId)
  }

  async function handleExport() {
    if (!selectedId) return
    setExporting(true)
    try {
      const res = await fetch('/api/employee-record/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: selectedId, from, to }),
      })
      if (!res.ok) {
        const d = await res.json()
        setMessage({ text: d.error || 'Export failed', type: 'error' })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${employee?.full_name || 'Employee'}_Record_${from}_to_${to}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      setMessage({ text: 'Export downloaded', type: 'success' })
    } catch {
      setMessage({ text: 'Network error', type: 'error' })
    } finally {
      setExporting(false)
    }
  }

  // Build timeline
  const timeline = useMemo(() => {
    const items: TimelineItem[] = []

    if (filter === 'All' || filter === 'Shifts') {
      for (const s of shifts) items.push({ date: s.clock_in_at, type: 'shift', data: s })
    }
    if (filter === 'All' || filter === 'Edits') {
      for (const e of edits) items.push({ date: e.edited_at, type: 'edit', data: e })
    }
    if (filter === 'All' || filter === 'Accountability') {
      for (const a of accountability) items.push({ date: a.created_at, type: 'accountability', data: a })
    }
    if (filter === 'All' || filter === 'Flags') {
      for (const f of flags) items.push({ date: f.created_at, type: 'flag', data: f })
    }
    if (filter === 'All' || filter === 'Overrides') {
      for (const o of overrides) items.push({ date: o.created_at, type: 'override', data: o })
    }
    if (filter === 'All' || filter === 'Time Off') {
      for (const t of timeOff) items.push({ date: t.created_at, type: 'timeoff', data: t })
    }

    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    return items
  }, [shifts, edits, accountability, flags, overrides, timeOff, filter])

  const filterCounts = useMemo(() => ({
    All: shifts.length + edits.length + accountability.length + flags.length + overrides.length + timeOff.length,
    Shifts: shifts.length,
    Edits: edits.length,
    Accountability: accountability.length,
    Flags: flags.length,
    Overrides: overrides.length,
    'Time Off': timeOff.length,
  }), [shifts, edits, accountability, flags, overrides, timeOff])

  const filteredEmployees = employees.filter(e =>
    e.full_name.toLowerCase().includes(search.toLowerCase()) ||
    e.username.toLowerCase().includes(search.toLowerCase()) ||
    (e.manager_name || '').toLowerCase().includes(search.toLowerCase())
  )

  if (!session || !ALLOWED.includes(session.role)) {
    return (
      <div className="min-h-screen bg-gray-950 pb-20 pt-14">
        {session && <NavBar role={session.role} fullName={session.fullName} />}
        <div className="max-w-3xl mx-auto px-4 py-20 text-center text-gray-500">Access restricted</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="max-w-4xl mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-white mb-1">Employee Record</h1>
        <p className="text-sm text-gray-500 mb-4">Time punches, edits, flags, and documentation in chronological order</p>

        {message && (
          <div className={`mb-4 px-4 py-2 rounded-xl text-sm font-medium ${message.type === 'error' ? 'bg-red-900/30 text-red-300' : 'bg-green-900/30 text-green-300'}`}>
            {message.text}
          </div>
        )}

        {/* Employee selector */}
        {!selectedId && (
          <>
            <input
              type="text"
              placeholder="Search employees..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 mb-3"
            />
            {loading ? (
              <div className="text-center text-gray-500 py-10">Loading employees...</div>
            ) : (
              <div className="space-y-2">
                {filteredEmployees.map(emp => (
                  <button
                    key={emp.id}
                    onClick={() => selectEmployee(emp.id)}
                    className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center justify-between hover:border-violet-500/50 transition-colors text-left"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{emp.full_name}</p>
                      <p className="text-xs text-gray-500">@{emp.username} · {emp.role === 'employee' ? 'Rep' : 'DM'}{emp.manager_name ? ` · ${emp.manager_name}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!emp.is_active && <span className="text-[10px] bg-red-900/40 text-red-400 px-2 py-0.5 rounded-full">Inactive</span>}
                      <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </div>
                  </button>
                ))}
                {filteredEmployees.length === 0 && <p className="text-center text-gray-600 py-6">No employees found</p>}
              </div>
            )}
          </>
        )}

        {/* Record view */}
        {selectedId && (
          <>
            {/* Back + employee header */}
            <button onClick={() => { setSelectedId(null); setEmployee(null); setSummary(null) }} className="text-violet-400 text-sm font-medium mb-3 flex items-center gap-1 hover:text-violet-300">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              Back to employees
            </button>

            {employee && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-bold text-white">{employee.full_name}</p>
                    <p className="text-xs text-gray-500">@{employee.username} · {employee.role === 'employee' ? 'Sales Rep' : employee.role.replace(/_/g, ' ')} · {employee.manager_name || 'No manager'}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {employee.is_terminated && <span className="text-[10px] bg-red-900/40 text-red-400 px-2 py-0.5 rounded-full">Terminated</span>}
                    {!employee.is_active && !employee.is_terminated && <span className="text-[10px] bg-amber-900/40 text-amber-400 px-2 py-0.5 rounded-full">Inactive</span>}
                  </div>
                </div>
              </div>
            )}

            {/* Date range */}
            <div className="flex items-end gap-2 mb-4">
              <div className="flex-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wide mb-1 block">From</label>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500" />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wide mb-1 block">To</label>
                <input type="date" value={to} onChange={e => setTo(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500" />
              </div>
              <button onClick={changeDates} disabled={recordLoading}
                className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
                {recordLoading ? '...' : 'Go'}
              </button>
            </div>

            {/* Summary cards */}
            {summary && (
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                  <p className="text-lg font-bold text-white">{summary.totalShifts}</p>
                  <p className="text-[10px] text-gray-500">Shifts</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                  <p className="text-lg font-bold text-white">{summary.totalHours}</p>
                  <p className="text-[10px] text-gray-500">Net Hours</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                  <p className="text-lg font-bold text-white">{summary.manualEntries}</p>
                  <p className="text-[10px] text-gray-500">Manual</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                  <p className="text-lg font-bold text-amber-400">{summary.editedShifts}</p>
                  <p className="text-[10px] text-gray-500">Edited</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                  <p className="text-lg font-bold text-white">{summary.gpsVerified}/{summary.totalShifts}</p>
                  <p className="text-[10px] text-gray-500">GPS Verified</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-center">
                  <p className="text-lg font-bold text-red-400">{summary.flagCount}</p>
                  <p className="text-[10px] text-gray-500">Flags</p>
                </div>
              </div>
            )}

            {/* Export button */}
            {summary && (
              <button onClick={handleExport} disabled={exporting}
                className="w-full bg-green-700 hover:bg-green-600 text-white text-sm font-semibold py-2.5 rounded-xl mb-4 disabled:opacity-50 flex items-center justify-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                {exporting ? 'Generating...' : 'Export Excel'}
              </button>
            )}

            {/* Filter pills */}
            {summary && (
              <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4 no-scrollbar">
                {FILTER_TYPES.map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === f ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                    {f}{filterCounts[f] > 0 ? ` (${filterCounts[f]})` : ''}
                  </button>
                ))}
              </div>
            )}

            {/* Timeline */}
            {recordLoading ? (
              <div className="text-center text-gray-500 py-10">Loading record...</div>
            ) : timeline.length === 0 && summary ? (
              <div className="text-center text-gray-600 py-10">No entries for this period and filter</div>
            ) : (
              <div className="space-y-2">
                {timeline.map((item, i) => (
                  <TimelineEntry key={`${item.type}-${i}`} item={item} shifts={shifts} edits={edits}
                    expandedShifts={expandedShifts} setExpandedShifts={setExpandedShifts} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function TimelineEntry({ item, shifts, edits, expandedShifts, setExpandedShifts }: {
  item: TimelineItem; shifts: Shift[]; edits: ShiftEdit[]
  expandedShifts: Set<string>; setExpandedShifts: (s: Set<string>) => void
}) {
  const { type, data } = item

  if (type === 'shift') {
    const s = data as Shift
    const shiftEdits = edits.filter(e => e.shift_id === s.id)
    const expanded = expandedShifts.has(s.id)

    return (
      <div
        className={`border rounded-xl px-4 py-3 cursor-pointer transition-colors ${
          shiftEdits.length > 0 ? 'bg-amber-900/10 border-amber-800/40' : s.is_manual ? 'bg-violet-900/10 border-violet-800/30' : 'bg-gray-900 border-gray-800'
        }`}
        onClick={() => {
          const next = new Set(expandedShifts)
          expanded ? next.delete(s.id) : next.add(s.id)
          setExpandedShifts(next)
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${shiftEdits.length > 0 ? 'bg-amber-400' : s.is_manual ? 'bg-violet-400' : 'bg-green-400'}`} />
            <div>
              <p className="text-sm font-medium text-white">
                {fmtDate(s.clock_in_at)} · {fmtTime(s.clock_in_at)} — {s.clock_out_at ? fmtTime(s.clock_out_at) : 'MISSING'}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                {s.store_address && <p className="text-[11px] text-gray-500">{s.store_address}</p>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-sm font-bold text-white">{s.duration_hours.toFixed(2)}h</p>
              <div className="flex items-center gap-1">
                {s.is_manual && <span className="text-[9px] bg-violet-900/50 text-violet-300 px-1.5 py-0.5 rounded">Manual</span>}
                {shiftEdits.length > 0 && <span className="text-[9px] bg-amber-900/50 text-amber-300 px-1.5 py-0.5 rounded">Edited</span>}
                {s.geofence_override && <span className="text-[9px] bg-cyan-900/50 text-cyan-300 px-1.5 py-0.5 rounded">Override</span>}
                {!s.clock_in_lat && <span className="text-[9px] bg-red-900/50 text-red-300 px-1.5 py-0.5 rounded">No GPS</span>}
              </div>
            </div>
            <svg className={`w-4 h-4 text-gray-600 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-gray-800 space-y-2 text-xs text-gray-400">
            <div className="grid grid-cols-2 gap-2">
              <p><span className="text-gray-600">Break:</span> {s.break_minutes} min</p>
              <p><span className="text-gray-600">Method:</span> {s.is_manual ? 'Manual entry' : 'Live clock'}</p>
              {s.clock_in_lat && <p><span className="text-gray-600">GPS In:</span> {s.clock_in_lat}, {s.clock_in_lng}</p>}
              {s.clock_out_lat && <p><span className="text-gray-600">GPS Out:</span> {s.clock_out_lat}, {s.clock_out_lng}</p>}
              {s.clock_in_address && <p className="col-span-2"><span className="text-gray-600">Address In:</span> {s.clock_in_address}</p>}
              {s.clock_out_address && <p className="col-span-2"><span className="text-gray-600">Address Out:</span> {s.clock_out_address}</p>}
              {s.manual_by_name && <p><span className="text-gray-600">Created by:</span> {s.manual_by_name}</p>}
              {s.manual_note && <p className="col-span-2"><span className="text-gray-600">Note:</span> {s.manual_note}</p>}
            </div>

            {shiftEdits.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wide mb-1">Edit History</p>
                {shiftEdits.map((e, i) => (
                  <div key={i} className="bg-amber-900/20 rounded-lg px-3 py-2 mb-1">
                    <div className="flex justify-between">
                      <div>
                        {e.old_clock_in && e.new_clock_in && (
                          <p>Clock In: <span className="line-through text-red-400">{fmtTime(e.old_clock_in)}</span> → <span className="text-green-400">{fmtTime(e.new_clock_in)}</span></p>
                        )}
                        {e.old_clock_out && e.new_clock_out && (
                          <p>Clock Out: <span className="line-through text-red-400">{fmtTime(e.old_clock_out)}</span> → <span className="text-green-400">{fmtTime(e.new_clock_out)}</span></p>
                        )}
                        {e.note && <p className="text-gray-500 mt-0.5">Note: {e.note}</p>}
                      </div>
                      <div className="text-right text-[10px] text-gray-500">
                        <p>{e.edited_by_name}</p>
                        <p>{fmtDate(e.edited_at)} {fmtTime(e.edited_at)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (type === 'edit') {
    const e = data as ShiftEdit
    const shift = shifts.find(s => s.id === e.shift_id)
    return (
      <div className="bg-amber-900/10 border border-amber-800/40 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-400" />
          <p className="text-sm font-medium text-amber-300">Timecard Edit</p>
          <p className="text-xs text-gray-500 ml-auto">{fmtDate(e.edited_at)} {fmtTime(e.edited_at)}</p>
        </div>
        <div className="mt-1.5 text-xs text-gray-400">
          <p>Shift: {shift ? `${fmtDate(shift.clock_in_at)}` : 'Unknown'}</p>
          {e.old_clock_in && e.new_clock_in && <p>Clock In: {fmtTime(e.old_clock_in)} → {fmtTime(e.new_clock_in)}</p>}
          {e.old_clock_out && e.new_clock_out && <p>Clock Out: {fmtTime(e.old_clock_out)} → {fmtTime(e.new_clock_out)}</p>}
          {e.note && <p className="text-gray-500">Note: {e.note}</p>}
          <p className="text-gray-600 mt-1">By: {e.edited_by_name}</p>
        </div>
      </div>
    )
  }

  if (type === 'accountability') {
    const a = data as AccountabilityDoc
    const levelColors: Record<string, string> = {
      documented_conversation: 'bg-teal-900/20 border-teal-800/40 text-teal-300',
      verbal: 'bg-amber-900/10 border-amber-800/40 text-amber-300',
      written: 'bg-orange-900/10 border-orange-800/40 text-orange-300',
      final: 'bg-red-900/10 border-red-800/40 text-red-300',
    }
    const colors = levelColors[a.level] || 'bg-gray-900 border-gray-800 text-gray-300'
    const levelLabel = a.level === 'documented_conversation' ? 'Documented Conversation'
      : a.level.charAt(0).toUpperCase() + a.level.slice(1) + ' Notice'

    return (
      <div className={`border rounded-xl px-4 py-3 ${colors.split(' ').slice(0, 2).join(' ')}`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${a.level === 'final' ? 'bg-red-400' : a.level === 'written' ? 'bg-orange-400' : a.level === 'verbal' ? 'bg-amber-400' : 'bg-teal-400'}`} />
          <p className={`text-sm font-medium ${colors.split(' ')[2]}`}>{levelLabel}</p>
          <span className={`text-[9px] px-1.5 py-0.5 rounded ${a.status === 'approved' ? 'bg-green-900/50 text-green-300' : 'bg-gray-800 text-gray-400'}`}>{a.status}</span>
          <p className="text-xs text-gray-500 ml-auto">{fmtDate(a.created_at)}</p>
        </div>
        <p className="text-sm text-white font-medium mt-1.5">{a.title}</p>
        <p className="text-xs text-gray-400 mt-1 line-clamp-3">{a.notes}</p>
        <p className="text-[10px] text-gray-600 mt-1.5">By: {a.author_name} · Ack: {a.ack_status}</p>
      </div>
    )
  }

  if (type === 'flag') {
    const f = data as Flag
    return (
      <div className={`border rounded-xl px-4 py-3 ${f.resolved ? 'bg-gray-900 border-gray-800' : 'bg-red-900/10 border-red-800/40'}`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${f.resolved ? 'bg-gray-400' : 'bg-red-400'}`} />
          <p className={`text-sm font-medium ${f.resolved ? 'text-gray-400' : 'text-red-300'}`}>
            Flag: {f.type.replace(/_/g, ' ')}
          </p>
          <span className={`text-[9px] px-1.5 py-0.5 rounded ${f.resolved ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
            {f.resolved ? 'Resolved' : 'Open'}
          </span>
          <p className="text-xs text-gray-500 ml-auto">{fmtDate(f.created_at)}</p>
        </div>
        {f.detail && <p className="text-xs text-gray-400 mt-1">{f.detail}</p>}
        {f.resolved_by_name && <p className="text-[10px] text-gray-600 mt-1">Resolved by: {f.resolved_by_name}{f.resolution_note ? ` — ${f.resolution_note}` : ''}</p>}
      </div>
    )
  }

  if (type === 'override') {
    const o = data as Override
    return (
      <div className="bg-cyan-900/10 border border-cyan-800/40 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400" />
          <p className="text-sm font-medium text-cyan-300">Geofence Override</p>
          <p className="text-xs text-gray-500 ml-auto">{fmtDate(o.created_at)} {fmtTime(o.created_at)}</p>
        </div>
        <div className="text-xs text-gray-400 mt-1">
          <p>{o.store_address || 'Unknown store'} — {o.reason}</p>
          {o.reported_distance_ft && <p className="text-gray-500">Distance: {o.reported_distance_ft}ft from store</p>}
          <p className="text-gray-600 mt-1">Approved by: {o.approved_by_name}</p>
        </div>
      </div>
    )
  }

  if (type === 'timeoff') {
    const t = data as TimeOff
    return (
      <div className={`border rounded-xl px-4 py-3 ${t.status === 'approved' ? 'bg-green-900/10 border-green-800/40' : t.status === 'denied' ? 'bg-red-900/10 border-red-800/40' : 'bg-gray-900 border-gray-800'}`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${t.status === 'approved' ? 'bg-green-400' : t.status === 'denied' ? 'bg-red-400' : 'bg-yellow-400'}`} />
          <p className={`text-sm font-medium ${t.status === 'approved' ? 'text-green-300' : t.status === 'denied' ? 'text-red-300' : 'text-yellow-300'}`}>Time Off Request</p>
          <span className={`text-[9px] px-1.5 py-0.5 rounded ${t.status === 'approved' ? 'bg-green-900/50 text-green-300' : t.status === 'denied' ? 'bg-red-900/50 text-red-300' : 'bg-yellow-900/50 text-yellow-300'}`}>
            {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
          </span>
          <p className="text-xs text-gray-500 ml-auto">{fmtDate(t.created_at)}</p>
        </div>
        <div className="text-xs text-gray-400 mt-1">
          <p>{fmtDateLong(t.start_date)} — {fmtDateLong(t.end_date)}{t.partial_day ? ` (${t.partial_start_time} - ${t.partial_end_time})` : ''}</p>
          {t.reason && <p className="text-gray-500 mt-0.5">{t.reason}</p>}
          {t.approver_name && <p className="text-gray-600 mt-1">{t.status === 'approved' ? 'Approved' : 'Reviewed'} by: {t.approver_name}</p>}
        </div>
      </div>
    )
  }

  return null
}
