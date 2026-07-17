'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'

interface Appointment {
  id: string; barber_name: string; customer_name: string; customer_phone: string | null
  appointment_date: string; start_time: string; end_time: string
  total_price: string; total_duration: number; status: string
  barber_note: string | null; service_names: string; decline_reason: string | null
  proposed_alt_date: string | null; proposed_alt_time: string | null; created_at: string
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-amber-900/30', text: 'text-amber-400', label: 'Pending' },
  confirmed: { bg: 'bg-green-900/30', text: 'text-green-400', label: 'Confirmed' },
  completed: { bg: 'bg-blue-900/30', text: 'text-blue-400', label: 'Completed' },
  cancelled: { bg: 'bg-zinc-800', text: 'text-zinc-500', label: 'Cancelled' },
  declined: { bg: 'bg-red-900/30', text: 'text-red-400', label: 'Declined' },
  expired: { bg: 'bg-zinc-800', text: 'text-zinc-600', label: 'Expired' },
}

export default function BarberDashboardPage() {
  const router = useRouter()
  const [session, setSession] = useState<{ id: string; fullName: string; role: string; org_id: string } | null>(null)
  const [view, setView] = useState<'day' | 'week' | 'list'>('day')
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)

  // Action modal
  const [actionAppt, setActionAppt] = useState<Appointment | null>(null)
  const [actionType, setActionType] = useState<'confirm' | 'decline' | 'complete' | 'reschedule' | 'barber_cancel' | null>(null)
  const [actionNote, setActionNote] = useState('')
  const [altDate, setAltDate] = useState('')
  const [altTime, setAltTime] = useState('')
  const [actioning, setActioning] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => {
      if (!d) return
      if (d.role !== 'barber' && d.role !== 'shop_owner' && d.role !== 'developer') { router.replace('/dashboard'); return }
      setSession(d)
    })
  }, [router])

  const loadAppointments = useCallback(async () => {
    if (!session) return
    setLoading(true)

    let url = '/api/barbershop/appointments?'
    if (view === 'day') {
      url += `date=${selectedDate}`
    } else if (view === 'week') {
      const d = new Date(selectedDate + 'T12:00:00')
      const day = d.getDay()
      const mon = new Date(d)
      mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
      const sun = new Date(mon)
      sun.setDate(mon.getDate() + 6)
      url += `from=${mon.toISOString().split('T')[0]}&to=${sun.toISOString().split('T')[0]}`
    } else {
      const d = new Date(selectedDate + 'T12:00:00')
      const first = new Date(d.getFullYear(), d.getMonth(), 1)
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      url += `from=${first.toISOString().split('T')[0]}&to=${last.toISOString().split('T')[0]}`
    }

    const res = await fetch(url)
    if (res.ok) {
      const d = await res.json()
      setAppointments(d.appointments ?? [])
    }
    setLoading(false)
  }, [session, selectedDate, view])

  useEffect(() => { loadAppointments() }, [loadAppointments])

  async function handleAction() {
    if (!actionAppt || !actionType) return
    setActioning(true)
    await fetch(`/api/barbershop/appointments/${actionAppt.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: actionType,
        barber_note: actionNote.trim() || null,
        decline_reason: actionNote.trim() || null,
        proposed_alt_date: altDate || null,
        proposed_alt_time: altTime || null,
      }),
    })
    setActionAppt(null)
    setActionType(null)
    setActionNote('')
    setAltDate('')
    setAltTime('')
    setActioning(false)
    await loadAppointments()
  }

  if (!session) return null

  const today = new Date().toISOString().split('T')[0]
  const pendingCount = appointments.filter(a => a.status === 'pending').length

  // Timeline hours (7 AM to 9 PM)
  const timelineHours = Array.from({ length: 15 }, (_, i) => i + 7)

  function getApptPosition(appt: Appointment) {
    const [sh, sm] = appt.start_time.split(':').map(Number)
    const [eh, em] = appt.end_time.split(':').map(Number)
    const startMins = sh * 60 + sm - 7 * 60 // offset from 7 AM
    const durationMins = (eh * 60 + em) - (sh * 60 + sm)
    return { top: (startMins / 60) * 60, height: Math.max((durationMins / 60) * 60, 30) } // 60px per hour
  }

  return (
    <div className="min-h-screen bg-black pb-20 pt-14">
      <NavBar role={session.role as 'barber'} fullName={session.fullName} />

      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-blue-400">Appointments</h1>
          {pendingCount > 0 && (
            <span className="text-xs font-bold text-blue-400 bg-blue-900/30 px-2.5 py-1 rounded-full">{pendingCount} pending</span>
          )}
        </div>

        {/* Date nav + view toggle */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button onClick={() => {
              const d = new Date(selectedDate + 'T12:00:00')
              d.setDate(d.getDate() - (view === 'week' ? 7 : view === 'list' ? 30 : 1))
              setSelectedDate(d.toISOString().split('T')[0])
            }} className="text-zinc-400 hover:text-white p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-white text-sm" />
            <button onClick={() => {
              const d = new Date(selectedDate + 'T12:00:00')
              d.setDate(d.getDate() + (view === 'week' ? 7 : view === 'list' ? 30 : 1))
              setSelectedDate(d.toISOString().split('T')[0])
            }} className="text-zinc-400 hover:text-white p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
            {selectedDate !== today && (
              <button onClick={() => setSelectedDate(today)} className="text-xs text-blue-400 font-semibold">Today</button>
            )}
          </div>
          <div className="flex bg-zinc-800 rounded-lg p-0.5">
            {(['day', 'week', 'list'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${view === v ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'}`}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center text-zinc-500 py-12">Loading...</div>
        ) : view === 'day' ? (
          /* Day Timeline View */
          <div className="relative bg-zinc-900 border border-blue-500/20 rounded-2xl overflow-hidden">
            {appointments.length === 0 && (
              <div className="text-center text-zinc-600 py-16 text-sm">No appointments today</div>
            )}
            {appointments.length > 0 && (
              <div className="relative" style={{ height: timelineHours.length * 60 }}>
                {/* Hour lines */}
                {timelineHours.map((hour, i) => (
                  <div key={hour} className="absolute w-full border-t border-zinc-800/60" style={{ top: i * 60 }}>
                    <span className="text-[10px] text-zinc-600 absolute -top-2 left-2">{hour % 12 || 12} {hour >= 12 ? 'PM' : 'AM'}</span>
                  </div>
                ))}
                {/* Appointment blocks */}
                {appointments.filter(a => a.status !== 'cancelled' && a.status !== 'expired').map(appt => {
                  const pos = getApptPosition(appt)
                  const style = STATUS_STYLES[appt.status] ?? STATUS_STYLES.pending
                  return (
                    <button key={appt.id} onClick={() => { setActionAppt(appt); setActionType(null) }}
                      className={`absolute left-12 right-2 rounded-lg px-3 py-1.5 border-l-4 text-left overflow-hidden transition-colors hover:brightness-110 ${style.bg}`}
                      style={{ top: pos.top, height: pos.height, borderLeftColor: appt.status === 'confirmed' ? '#22c55e' : appt.status === 'pending' ? '#f59e0b' : '#3b82f6' }}>
                      <p className="text-sm text-white font-medium truncate">{appt.customer_name}</p>
                      <p className="text-[10px] text-zinc-400">{fmtTime(appt.start_time)} – {fmtTime(appt.end_time)} · {appt.service_names}</p>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          /* List View (also used for week/month) */
          <div className="space-y-2">
            {appointments.length === 0 ? (
              <div className="text-center text-zinc-600 py-16 text-sm">No appointments</div>
            ) : appointments.map(appt => {
              const style = STATUS_STYLES[appt.status] ?? STATUS_STYLES.pending
              const dateLabel = new Date(appt.appointment_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              return (
                <button key={appt.id} onClick={() => { setActionAppt(appt); setActionType(null) }}
                  className="w-full bg-zinc-900 border border-blue-500/15 rounded-xl px-4 py-3 text-left hover:border-blue-500/40 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-white">{appt.customer_name}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>{style.label}</span>
                  </div>
                  <p className="text-xs text-zinc-400">{dateLabel} · {fmtTime(appt.start_time)} – {fmtTime(appt.end_time)}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{appt.service_names} · ${Number(appt.total_price).toFixed(2)}</p>
                  {appt.customer_phone && <p className="text-xs text-zinc-600 mt-0.5">{appt.customer_phone}</p>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Action Modal */}
      {actionAppt && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center" onClick={() => setActionAppt(null)}>
          <div className="bg-zinc-900 border border-blue-500/30 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-blue-400">{actionAppt.customer_name}</h2>
              <button onClick={() => setActionAppt(null)} className="text-zinc-500 hover:text-white">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="space-y-2 mb-4">
              <p className="text-sm text-zinc-400">
                {new Date(actionAppt.appointment_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                {' · '}{fmtTime(actionAppt.start_time)} – {fmtTime(actionAppt.end_time)}
              </p>
              <p className="text-sm text-zinc-300">{actionAppt.service_names} · <span className="text-blue-400 font-semibold">${Number(actionAppt.total_price).toFixed(2)}</span></p>
              {actionAppt.customer_phone && <p className="text-sm text-zinc-500">{actionAppt.customer_phone}</p>}
            </div>

            {/* Action buttons based on status */}
            {actionAppt.status === 'pending' && !actionType && (
              <div className="flex gap-2">
                <button onClick={() => setActionType('confirm')} className="flex-1 bg-green-600 hover:bg-green-500 text-white font-semibold py-2.5 rounded-xl text-sm">Confirm</button>
                <button onClick={() => setActionType('decline')} className="flex-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 font-semibold py-2.5 rounded-xl text-sm border border-red-600/30">Decline</button>
              </div>
            )}

            {actionAppt.status === 'confirmed' && !actionType && (
              <div className="space-y-2">
                <button onClick={() => setActionType('complete')} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl text-sm">Mark Complete</button>
                <div className="flex gap-2">
                  <button onClick={() => setActionType('reschedule')} className="flex-1 bg-amber-600/20 hover:bg-amber-600/40 text-amber-400 font-semibold py-2.5 rounded-xl text-sm border border-amber-600/30">Reschedule</button>
                  <button onClick={() => setActionType('barber_cancel')} className="flex-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 font-semibold py-2.5 rounded-xl text-sm border border-red-600/30">Cancel</button>
                </div>
              </div>
            )}

            {actionType === 'confirm' && (
              <div className="space-y-3">
                <input value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder="Add a note (optional)" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-sm" />
                <button onClick={handleAction} disabled={actioning} className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm">
                  {actioning ? 'Confirming...' : 'Confirm Appointment'}
                </button>
              </div>
            )}

            {actionType === 'decline' && (
              <div className="space-y-3">
                <input value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder="Reason (optional)" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-sm" />
                <p className="text-xs text-zinc-500">Suggest an alternate time?</p>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={altDate} onChange={e => setAltDate(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
                  <input type="time" value={altTime} onChange={e => setAltTime(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
                </div>
                <button onClick={handleAction} disabled={actioning} className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm">
                  {actioning ? 'Declining...' : 'Decline & Notify Customer'}
                </button>
              </div>
            )}

            {actionType === 'complete' && (
              <div className="space-y-3">
                <input value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder="Notes about this appointment (optional)" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-sm" />
                <button onClick={handleAction} disabled={actioning} className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm">
                  {actioning ? 'Completing...' : 'Mark as Complete'}
                </button>
              </div>
            )}

            {actionType === 'reschedule' && (
              <div className="space-y-3">
                <p className="text-xs text-amber-400 font-semibold">Propose a new time for this appointment</p>
                <input value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder="Reason for rescheduling (optional)" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-sm" />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">New Date</label>
                    <input type="date" value={altDate} onChange={e => setAltDate(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">New Time</label>
                    <input type="time" value={altTime} onChange={e => setAltTime(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
                  </div>
                </div>
                <button onClick={handleAction} disabled={actioning || !altDate || !altTime} className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm">
                  {actioning ? 'Sending...' : 'Send Reschedule to Customer'}
                </button>
                <button onClick={() => setActionType(null)} className="w-full text-xs text-zinc-500 hover:text-zinc-300 py-1">Back</button>
              </div>
            )}

            {actionType === 'barber_cancel' && (
              <div className="space-y-3">
                <p className="text-xs text-red-400 font-semibold">Cancel this confirmed appointment</p>
                <input value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder="Reason for cancellation (optional)" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-sm" />
                <button onClick={handleAction} disabled={actioning} className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm">
                  {actioning ? 'Cancelling...' : 'Cancel & Notify Customer'}
                </button>
                <button onClick={() => setActionType(null)} className="w-full text-xs text-zinc-500 hover:text-zinc-300 py-1">Back</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
