'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

interface ApptData {
  id: string
  barber_id: string
  barber_name: string
  original_date: string
  original_time: string
  proposed_date: string
  proposed_time: string
  service_names: string
  total_price: string
  shop_name: string
  shop_address: string | null
  status: string
  decline_reason: string | null
}

interface TimeSlot { time: string; available: boolean }

export default function RespondPage() {
  const params = useParams()
  const apptId = params.id as string
  const [data, setData] = useState<ApptData | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [done, setDone] = useState<'accepted' | 'rescheduled' | null>(null)
  const [error, setError] = useState('')

  // Pick different time state
  const [picking, setPicking] = useState(false)
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`/api/barbershop/respond?id=${apptId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.appointment) setData(d.appointment)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [apptId])

  async function acceptProposal() {
    setAccepting(true)
    setError('')
    const res = await fetch('/api/barbershop/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: apptId, action: 'accept' }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Something went wrong')
      setAccepting(false)
      return
    }
    setDone('accepted')
    setAccepting(false)
  }

  async function loadSlots(date: string) {
    if (!data) return
    setSelectedDate(date)
    setSelectedTime('')
    setLoadingSlots(true)
    const res = await fetch(`/api/barbershop/availability?barberId=${data.barber_id}&date=${date}`)
    if (res.ok) {
      const d = await res.json()
      setSlots(d.slots ?? [])
    }
    setLoadingSlots(false)
  }

  async function submitNewTime() {
    if (!selectedDate || !selectedTime) return
    setSubmitting(true)
    setError('')
    const res = await fetch('/api/barbershop/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: apptId, action: 'pick_time', date: selectedDate, time: selectedTime }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Failed to reschedule')
      setSubmitting(false)
      return
    }
    setDone('rescheduled')
    setSubmitting(false)
  }

  if (loading) return <div className="min-h-screen bg-black" />

  if (!data) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-zinc-400 text-sm">This appointment could not be found or has already been updated.</p>
          <a href="/customer-signup" className="text-blue-400 text-sm mt-4 inline-block">Book a new appointment →</a>
        </div>
      </div>
    )
  }

  if (done === 'accepted') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Appointment Confirmed!</h2>
          <p className="text-zinc-400 text-sm mb-1">
            {new Date(data.proposed_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at {fmtTime(data.proposed_time)}
          </p>
          <p className="text-zinc-500 text-xs mb-6">with {data.barber_name}</p>
          <a href="/my-appointments" className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-xl text-sm inline-block">
            View My Appointments
          </a>
        </div>
      </div>
    )
  }

  if (done === 'rescheduled') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">New Time Requested!</h2>
          <p className="text-zinc-400 text-sm mb-1">
            {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at {fmtTime(selectedTime)}
          </p>
          <p className="text-zinc-500 text-xs mb-6">Your barber will confirm shortly</p>
          <a href="/my-appointments" className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-xl text-sm inline-block">
            View My Appointments
          </a>
        </div>
      </div>
    )
  }

  const origDateLabel = new Date(data.original_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const newDateLabel = new Date(data.proposed_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // Generate next 14 days for the picker
  const dates = Array.from({ length: 14 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    return d.toISOString().split('T')[0]
  })

  return (
    <div className="min-h-screen bg-black px-4 py-6">
      <div className="max-w-sm mx-auto">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-600/20 mb-4">
            <svg className="w-7 h-7 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white">Reschedule Request</h1>
          <p className="text-sm text-zinc-400 mt-1">{data.barber_name} wants to reschedule</p>
        </div>

        {/* Original time crossed out */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 mb-3">
          <p className="text-xs text-zinc-600 mb-1">Original time</p>
          <p className="text-sm text-zinc-500 line-through">{origDateLabel} at {fmtTime(data.original_time)}</p>
        </div>

        {!picking ? (
          <>
            {/* Proposed new time */}
            <div className="bg-zinc-900 border border-blue-500/30 rounded-xl px-4 py-4 mb-3">
              <p className="text-xs text-blue-400 font-semibold mb-1">Proposed new time</p>
              <p className="text-lg font-bold text-white">{newDateLabel}</p>
              <p className="text-lg font-bold text-blue-400">{fmtTime(data.proposed_time)}</p>
              {data.service_names && <p className="text-xs text-zinc-500 mt-2">{data.service_names}</p>}
              {Number(data.total_price) > 0 && <p className="text-sm text-blue-400 font-semibold mt-1">${Number(data.total_price).toFixed(2)}</p>}
            </div>

            {data.decline_reason && data.decline_reason !== 'Rescheduling' && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 mb-4">
                <p className="text-xs text-zinc-500">Note from {data.barber_name}:</p>
                <p className="text-sm text-zinc-300 mt-0.5">{data.decline_reason}</p>
              </div>
            )}

            {error && <p className="text-sm text-red-400 text-center mb-3">{error}</p>}

            <div className="space-y-2">
              <button onClick={acceptProposal} disabled={accepting}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors">
                {accepting ? 'Confirming...' : 'Accept New Time'}
              </button>
              <button onClick={() => setPicking(true)}
                className="w-full bg-zinc-900 border border-zinc-700 hover:border-blue-500/50 text-zinc-300 font-semibold py-3 rounded-xl text-sm transition-colors">
                Pick a Different Time
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Inline date/time picker */}
            <h2 className="text-base font-bold text-blue-400 mb-3">Pick a Different Time</h2>

            {/* Date grid */}
            {!selectedDate && (
              <div className="grid grid-cols-2 gap-2 mb-4">
                {dates.map(date => {
                  const d = new Date(date + 'T12:00:00')
                  const isToday = date === new Date().toISOString().split('T')[0]
                  return (
                    <button key={date} onClick={() => loadSlots(date)}
                      className="px-4 py-3 rounded-xl border bg-zinc-900 border-zinc-800 hover:border-blue-500/50 text-left transition-colors">
                      <p className="text-sm font-semibold text-white">{d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                      {isToday && <p className="text-[10px] text-blue-400 font-semibold">TODAY</p>}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Time slots */}
            {selectedDate && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-zinc-400">
                    {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  </p>
                  <button onClick={() => { setSelectedDate(''); setSelectedTime(''); setSlots([]) }}
                    className="text-xs text-blue-400 font-semibold">Change date</button>
                </div>

                {loadingSlots ? (
                  <p className="text-zinc-500 text-center py-6">Loading times...</p>
                ) : slots.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-zinc-500 text-sm">No available times on this date.</p>
                    <button onClick={() => { setSelectedDate(''); setSlots([]) }} className="text-blue-400 text-sm mt-2">Pick a different date</button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {slots.map(slot => (
                      <button key={slot.time} onClick={() => setSelectedTime(slot.time)}
                        className={`py-3 rounded-xl border text-sm font-semibold transition-colors ${
                          selectedTime === slot.time ? 'bg-blue-600 border-blue-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-blue-500/50'
                        }`}>
                        {fmtTime(slot.time)}
                      </button>
                    ))}
                  </div>
                )}

                {selectedTime && (
                  <>
                    {/* Confirmation summary */}
                    <div className="bg-zinc-900 border border-blue-500/20 rounded-xl px-4 py-3 mb-3">
                      <p className="text-xs text-blue-400 font-semibold mb-1">Your selected time</p>
                      <p className="text-sm font-bold text-white">
                        {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {fmtTime(selectedTime)}
                      </p>
                    </div>

                    {error && <p className="text-sm text-red-400 text-center mb-3">{error}</p>}

                    <button onClick={submitNewTime} disabled={submitting}
                      className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm">
                      {submitting ? 'Requesting...' : 'Request This Time'}
                    </button>
                  </>
                )}
              </>
            )}

            <button onClick={() => { setPicking(false); setSelectedDate(''); setSelectedTime(''); setSlots([]) }}
              className="w-full text-xs text-zinc-500 hover:text-zinc-300 py-3 mt-2">
              Back to proposed time
            </button>
          </>
        )}

        {data.shop_name && (
          <p className="text-center text-xs text-zinc-700 mt-4">{data.shop_name}{data.shop_address ? ` · ${data.shop_address}` : ''}</p>
        )}
      </div>
    </div>
  )
}
