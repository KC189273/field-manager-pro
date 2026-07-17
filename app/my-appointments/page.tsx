'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Appointment {
  id: string; barber_name: string; customer_name: string
  appointment_date: string; start_time: string; end_time: string
  total_price: string; total_duration: number; status: string
  service_names: string; decline_reason: string | null
  proposed_alt_date: string | null; proposed_alt_time: string | null
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function getCountdown(date: string, time: string): string {
  const apptTime = new Date(`${date}T${time}`)
  const now = new Date()
  const diff = apptTime.getTime() - now.getTime()
  if (diff <= 0) return 'Now'
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Awaiting Confirmation', color: 'text-amber-400' },
  confirmed: { label: 'Confirmed', color: 'text-green-400' },
  completed: { label: 'Completed', color: 'text-blue-400' },
  cancelled: { label: 'Cancelled', color: 'text-zinc-500' },
  declined: { label: 'Not Confirmed', color: 'text-red-400' },
  expired: { label: 'Expired', color: 'text-zinc-600' },
}

export default function MyAppointmentsPage() {
  const router = useRouter()
  const [session, setSession] = useState<{ id: string; role: string; fullName: string } | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => {
      if (!d) return
      if (d.role !== 'customer') { router.replace('/dashboard'); return }
      setSession(d)
    })
  }, [router])

  const loadAppointments = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/barbershop/appointments')
    if (res.ok) {
      const d = await res.json()
      setAppointments(d.appointments ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { if (session) loadAppointments() }, [session, loadAppointments])

  // Countdown ticker
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000)
    return () => clearInterval(interval)
  }, [])

  async function cancelAppointment(apptId: string) {
    if (!confirm('Cancel this appointment?')) return
    setCancelling(apptId)
    await fetch(`/api/barbershop/appointments/${apptId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    })
    setCancelling(null)
    await loadAppointments()
  }

  if (!session) return null

  const now = new Date()
  const upcoming = appointments.filter(a =>
    (a.status === 'pending' || a.status === 'confirmed') &&
    new Date(`${a.appointment_date}T${a.end_time}`) > now
  ).sort((a, b) => `${a.appointment_date}${a.start_time}`.localeCompare(`${b.appointment_date}${b.start_time}`))

  const past = appointments.filter(a =>
    a.status === 'completed' || a.status === 'cancelled' || a.status === 'declined' || a.status === 'expired' ||
    ((a.status === 'confirmed' || a.status === 'pending') && new Date(`${a.appointment_date}T${a.end_time}`) <= now)
  ).sort((a, b) => `${b.appointment_date}${b.start_time}`.localeCompare(`${a.appointment_date}${a.start_time}`))

  const nextAppt = upcoming[0]

  return (
    <div className="min-h-screen bg-black px-4 py-6 pb-20">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-blue-400">My Appointments</h1>
          <button onClick={() => router.push('/book')}
            className="text-xs font-semibold text-blue-400 bg-blue-900/30 px-3 py-1.5 rounded-lg hover:bg-blue-900/50">
            + Book New
          </button>
        </div>

        {loading ? (
          <div className="text-center text-zinc-500 py-12">Loading...</div>
        ) : (
          <>
            {/* Next Appointment Countdown */}
            {nextAppt && (
              <div className="bg-gradient-to-r from-blue-600/20 to-blue-900/20 border border-blue-500/30 rounded-2xl p-5 mb-6">
                <p className="text-xs text-blue-300 uppercase tracking-wide font-semibold mb-1">Next Appointment</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg font-bold text-white">{nextAppt.barber_name}</p>
                    <p className="text-sm text-zinc-400">
                      {new Date(nextAppt.appointment_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {' · '}{fmtTime(nextAppt.start_time)}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">{nextAppt.service_names}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-blue-400">{getCountdown(nextAppt.appointment_date, nextAppt.start_time)}</p>
                    <p className={`text-xs font-semibold ${STATUS_LABELS[nextAppt.status]?.color ?? 'text-zinc-500'}`}>
                      {STATUS_LABELS[nextAppt.status]?.label ?? nextAppt.status}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Upcoming */}
            {upcoming.length > 0 && (
              <div className="mb-6">
                <h2 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-3">Upcoming</h2>
                <div className="space-y-2">
                  {upcoming.map(appt => {
                    const dateLabel = new Date(appt.appointment_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                    const status = STATUS_LABELS[appt.status] ?? { label: appt.status, color: 'text-zinc-500' }
                    return (
                      <div key={appt.id} className="bg-zinc-900 border border-blue-500/15 rounded-xl px-4 py-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-white">{appt.barber_name}</span>
                          <span className={`text-[10px] font-bold ${status.color}`}>{status.label}</span>
                        </div>
                        <p className="text-xs text-zinc-400">{dateLabel} · {fmtTime(appt.start_time)} – {fmtTime(appt.end_time)}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{appt.service_names} · ${Number(appt.total_price).toFixed(2)}</p>

                        {appt.status === 'declined' && appt.proposed_alt_date && (
                          <div className="mt-2 bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2">
                            <p className="text-xs text-amber-400">Suggested alternate: {new Date(appt.proposed_alt_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                              {appt.proposed_alt_time ? ` at ${fmtTime(appt.proposed_alt_time)}` : ''}</p>
                          </div>
                        )}

                        {(appt.status === 'pending' || appt.status === 'confirmed') && (
                          <button onClick={() => cancelAppointment(appt.id)} disabled={cancelling === appt.id}
                            className="mt-2 text-xs text-red-400 hover:text-red-300 font-semibold">
                            {cancelling === appt.id ? 'Cancelling...' : 'Cancel Appointment'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Past Visits */}
            {past.length > 0 && (
              <div>
                <h2 className="text-xs font-bold text-blue-400/60 uppercase tracking-widest mb-3">Past Visits</h2>
                <div className="space-y-2">
                  {past.map(appt => {
                    const dateLabel = new Date(appt.appointment_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    return (
                      <div key={appt.id} className="bg-zinc-900 border border-blue-500/15 rounded-xl px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-white">{appt.barber_name}</p>
                            <p className="text-xs text-zinc-500">{dateLabel} · {appt.service_names}</p>
                          </div>
                          <button onClick={() => router.push('/book')}
                            className="text-xs text-blue-400 font-semibold hover:text-blue-300">
                            Rebook
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {upcoming.length === 0 && past.length === 0 && (
              <div className="text-center py-16">
                <p className="text-zinc-500 text-sm mb-4">No appointments yet</p>
                <button onClick={() => router.push('/book')}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-xl text-sm">
                  Book Your First Appointment
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
