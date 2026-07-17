'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type Step = 'barber' | 'service' | 'date' | 'time' | 'confirm'

interface Barber {
  id: string; display_name: string; avatar_url: string | null; bio: string | null
  services: Array<{ id: string; name: string; price: string; duration_minutes: number }>
  venmo_username: string | null; cashapp_tag: string | null
  portfolio: Array<{ url: string | null; caption: string | null }>
}

interface TimeSlot { time: string; available: boolean }

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

export default function BookPage() {
  const router = useRouter()
  const [session, setSession] = useState<{ id: string; role: string; org_id: string; fullName: string } | null>(null)
  const [step, setStep] = useState<Step>('barber')
  const [barbers, setBarbers] = useState<Barber[]>([])
  const [selectedBarber, setSelectedBarber] = useState<Barber | null>(null)
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { router.replace('/login'); return null }
      return r.json()
    }).then(d => {
      if (!d) return
      if (d.role !== 'customer') { router.replace('/barber-dashboard'); return }
      setSession(d)
    })
  }, [router])

  useEffect(() => {
    if (!session) return
    fetch(`/api/barbershop/barbers?orgId=${session.org_id}`)
      .then(r => r.json())
      .then(d => {
        const b = d.barbers ?? []
        setBarbers(b)
        if (b.length === 1) {
          setSelectedBarber(b[0])
          if (b[0].services.length === 1) setSelectedServices([b[0].services[0].id])
          setStep(b[0].services.length <= 1 ? 'date' : 'service')
        }
      })
  }, [session])

  function pickBarber(barber: Barber) {
    setSelectedBarber(barber)
    setSelectedServices([])
    if (barber.services.length <= 1) {
      if (barber.services.length === 1) setSelectedServices([barber.services[0].id])
      setStep('date')
    } else {
      setStep('service')
    }
  }

  function toggleService(svcId: string) {
    setSelectedServices(prev => prev.includes(svcId) ? prev.filter(s => s !== svcId) : [...prev, svcId])
  }

  function confirmServices() {
    if (selectedServices.length === 0 && selectedBarber?.services.length) {
      setSelectedServices([selectedBarber.services[0].id])
    }
    setStep('date')
  }

  async function pickDate(date: string) {
    setSelectedDate(date)
    setSelectedTime('')
    if (!selectedBarber) return
    setLoading(true)
    const res = await fetch(`/api/barbershop/availability?barberId=${selectedBarber.id}&date=${date}`)
    if (res.ok) {
      const d = await res.json()
      setSlots(d.slots ?? [])
    }
    setLoading(false)
    setStep('time')
  }

  function pickTime(time: string) {
    setSelectedTime(time)
    setStep('confirm')
  }

  async function submitBooking() {
    if (!selectedBarber || !selectedDate || !selectedTime) return
    setSubmitting(true)
    setError('')
    const res = await fetch('/api/barbershop/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barberId: selectedBarber.id, serviceIds: selectedServices, date: selectedDate, startTime: selectedTime }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Failed to book. Please try again.')
      setSubmitting(false)
      return
    }
    setSubmitted(true)
    setSubmitting(false)
  }

  if (!session) return null

  const totalPrice = selectedBarber?.services.filter(s => selectedServices.includes(s.id)).reduce((sum, s) => sum + Number(s.price), 0) ?? 0
  const totalDuration = selectedBarber?.services.filter(s => selectedServices.includes(s.id)).reduce((sum, s) => sum + s.duration_minutes, 0) ?? 0

  // Generate next 14 days
  const dates = Array.from({ length: 14 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    return d.toISOString().split('T')[0]
  })

  // Collect all portfolio photos from selected barber (or all barbers)
  const portfolioPhotos = (selectedBarber ?? barbers[0])?.portfolio.filter(p => p.url) ?? []

  if (submitted) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4 pb-20">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Booking Requested!</h2>
          <p className="text-zinc-400 text-sm mb-1">Your appointment with {selectedBarber?.display_name} has been submitted.</p>
          <p className="text-zinc-500 text-xs mb-6">You&apos;ll receive a notification once your barber confirms.</p>
          <button onClick={() => router.push('/my-appointments')} className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-xl text-sm">
            View My Appointments
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Portfolio banner — visible during date/time/confirm steps */}
      {selectedBarber && portfolioPhotos.length > 0 && step !== 'barber' && (
        <div className="relative w-full h-40 overflow-hidden">
          <div className="absolute inset-0 flex">
            {portfolioPhotos.slice(0, 4).map((p, i) => (
              <div key={i} className="flex-1 min-w-0">
                <img src={p.url!} alt={p.caption ?? ''} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black" />
          {/* Barber info overlay */}
          <div className="absolute bottom-3 left-4 flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-zinc-800 border-2 border-blue-500/50 overflow-hidden shrink-0">
              {selectedBarber.avatar_url ? (
                <img src={selectedBarber.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-500 font-bold text-sm">{selectedBarber.display_name.charAt(0)}</div>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-white drop-shadow">{selectedBarber.display_name}</p>
              {selectedServices.length > 0 && (
                <p className="text-[10px] text-zinc-300 drop-shadow">{selectedBarber.services.filter(s => selectedServices.includes(s.id)).map(s => s.name).join(', ')}</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Back button */}
        {step !== 'barber' && (
          <button onClick={() => {
            if (step === 'confirm') setStep('time')
            else if (step === 'time') setStep('date')
            else if (step === 'date') setStep(selectedBarber && selectedBarber.services.length > 1 ? 'service' : 'barber')
            else if (step === 'service') setStep('barber')
          }} className="text-blue-400 text-sm mb-4 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back
          </button>
        )}

        {/* Step 1: Pick barber */}
        {step === 'barber' && (
          <>
            <h1 className="text-xl font-bold text-blue-400 mb-4">Choose Your Barber</h1>
            {barbers.length === 0 && !loading && (
              <div className="text-center py-12">
                <p className="text-zinc-400 text-sm">This shop hasn&apos;t set up any barbers yet.</p>
                <p className="text-zinc-600 text-xs mt-1">Check back soon!</p>
              </div>
            )}
            <div className="space-y-3">
              {barbers.map(b => (
                <button key={b.id} onClick={() => pickBarber(b)}
                  className="w-full bg-zinc-900 border border-blue-500/15 rounded-2xl p-4 text-left hover:border-blue-500/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden">
                      {b.avatar_url ? <img src={b.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover" /> :
                        <span className="text-zinc-500 font-bold">{b.display_name.charAt(0)}</span>}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{b.display_name}</p>
                      {b.bio && <p className="text-xs text-zinc-500 mt-0.5">{b.bio}</p>}
                      <p className="text-xs text-zinc-600 mt-1">{b.services.length} service{b.services.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  {b.portfolio.length > 0 && (
                    <div className="flex gap-1.5 mt-3 overflow-x-auto">
                      {b.portfolio.filter(p => p.url).map((p, i) => (
                        <div key={i} className="w-16 h-16 rounded-lg overflow-hidden shrink-0 border border-blue-500/20">
                          <img src={p.url!} alt={p.caption ?? ''} className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Step 2: Pick services */}
        {step === 'service' && selectedBarber && (
          <>
            <h1 className="text-xl font-bold text-blue-400 mb-4">Select Services</h1>
            <div className="space-y-2">
              {selectedBarber.services.map(svc => (
                <button key={svc.id} onClick={() => toggleService(svc.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                    selectedServices.includes(svc.id) ? 'bg-blue-600/15 border-blue-500' : 'bg-zinc-900 border-zinc-800 hover:border-zinc-600'
                  }`}>
                  <div>
                    <p className="text-sm text-white font-medium">{svc.name}</p>
                    <p className="text-xs text-zinc-500">{svc.duration_minutes} min</p>
                  </div>
                  <span className="text-sm font-semibold text-blue-400">${Number(svc.price).toFixed(2)}</span>
                </button>
              ))}
            </div>
            {selectedServices.length > 0 && (
              <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-zinc-400">{selectedServices.length} service{selectedServices.length !== 1 ? 's' : ''} · {totalDuration} min</span>
                <span className="text-sm font-bold text-white">${totalPrice.toFixed(2)}</span>
              </div>
            )}
            <button onClick={confirmServices}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl text-sm mt-4">
              Continue
            </button>
          </>
        )}

        {/* Step 3: Pick date */}
        {step === 'date' && (
          <>
            <h1 className="text-xl font-bold text-blue-400 mb-4">Pick a Date</h1>
            <div className="grid grid-cols-2 gap-2">
              {dates.map(date => {
                const d = new Date(date + 'T12:00:00')
                const isToday = date === new Date().toISOString().split('T')[0]
                return (
                  <button key={date} onClick={() => pickDate(date)}
                    className={`px-4 py-3 rounded-xl border text-left transition-colors ${
                      selectedDate === date ? 'bg-blue-600/15 border-blue-500' : 'bg-zinc-900 border-zinc-800 hover:border-zinc-600'
                    }`}>
                    <p className="text-sm font-semibold text-white">{d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                    {isToday && <p className="text-[10px] text-blue-400 font-semibold">TODAY</p>}
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* Step 4: Pick time */}
        {step === 'time' && (
          <>
            <h1 className="text-xl font-bold text-blue-400 mb-2">Available Times</h1>
            <p className="text-xs text-zinc-500 mb-4">{new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            {loading ? (
              <p className="text-zinc-500 text-center py-8">Loading available times...</p>
            ) : slots.filter(s => s.available).length === 0 ? (
              <div className="text-center py-8">
                <p className="text-zinc-500 text-sm">No available times on this date.</p>
                <button onClick={() => setStep('date')} className="text-blue-400 text-sm mt-2">Pick a different date</button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {slots.filter(s => s.available).map(slot => (
                  <button key={slot.time} onClick={() => pickTime(slot.time)}
                    className={`py-3 rounded-xl border text-sm font-semibold transition-colors ${
                      selectedTime === slot.time ? 'bg-blue-600 border-blue-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-blue-500/50'
                    }`}>
                    {fmtTime(slot.time)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Step 5: Confirm */}
        {step === 'confirm' && selectedBarber && (
          <>
            <h1 className="text-xl font-bold text-blue-400 mb-4">Confirm Booking</h1>
            <div className="bg-zinc-900 border border-blue-500/20 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">Barber</span>
                <span className="text-sm text-white font-semibold">{selectedBarber.display_name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">Date</span>
                <span className="text-sm text-white">{new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">Time</span>
                <span className="text-sm text-white">{fmtTime(selectedTime)}</span>
              </div>
              {selectedServices.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-400">Services</span>
                  <span className="text-sm text-white">{selectedBarber.services.filter(s => selectedServices.includes(s.id)).map(s => s.name).join(', ')}</span>
                </div>
              )}
              {totalPrice > 0 && (
                <div className="flex items-center justify-between border-t border-zinc-800 pt-3">
                  <span className="text-sm text-zinc-400">Total</span>
                  <span className="text-lg font-bold text-blue-400">${totalPrice.toFixed(2)}</span>
                </div>
              )}
            </div>

            {error && <p className="text-sm text-red-400 text-center mt-3">{error}</p>}

            <button onClick={submitBooking} disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm mt-4">
              {submitting ? 'Booking...' : 'Request Appointment'}
            </button>
            <p className="text-xs text-zinc-600 text-center mt-2">Your barber will confirm your appointment</p>
          </>
        )}
      </div>
    </div>
  )
}
