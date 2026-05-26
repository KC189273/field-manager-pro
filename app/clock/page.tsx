'use client'

import { useState, useEffect, useCallback } from 'react'
import NavBar from '@/components/NavBar'
import { startNativeTracking, stopNativeTracking, isCapacitor } from '@/lib/gps-native'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface TodayShift {
  start_time: string
  end_time: string
  store_address: string
  role_note: string | null
  break_minutes: number
}

interface ClockStatus {
  activeShift: {
    id: string
    clock_in_at: string
    clock_in_address: string | null
    store_location_id: string | null
    store_address: string | null
  } | null
  activeBreak: {
    id: string
    break_start: string
  } | null
  scheduledToday: boolean
  todayShifts: TodayShift[]
}

interface Store {
  id: string
  address: string
}

export default function ClockPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<ClockStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [elapsed, setElapsed] = useState('')
  const [locating, setLocating] = useState(false)
  const [gpsStatus, setGpsStatus] = useState<'unknown' | 'granted' | 'denied' | 'unavailable'>('unknown')
  const [showAlwaysBanner, setShowAlwaysBanner] = useState(false)
  const [stores, setStores] = useState<Store[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [confirmingClockOut, setConfirmingClockOut] = useState(false)
  const [handoffNote, setHandoffNote] = useState('')
  const [breakLoading, setBreakLoading] = useState(false)
  const [breakElapsed, setBreakElapsed] = useState('')
  const [showDisclosure, setShowDisclosure] = useState(false)

  const fetchStatus = useCallback(async () => {
    const [meRes, statusRes] = await Promise.all([
      fetch('/api/auth/me'),
      fetch('/api/clock/status'),
    ])
    if (meRes.ok) setSession(await meRes.json())
    if (statusRes.ok) setStatus(await statusRes.json())
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  useEffect(() => {
    fetch('/api/clock/my-stores').then(r => r.json()).then(d => {
      if (d.stores) setStores(d.stores)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) { setGpsStatus('unavailable'); return }
    navigator.permissions?.query({ name: 'geolocation' as PermissionName })
      .then(result => {
        setGpsStatus(result.state === 'granted' ? 'granted' : result.state === 'denied' ? 'denied' : 'unknown')
        result.onchange = () => setGpsStatus(result.state === 'granted' ? 'granted' : result.state === 'denied' ? 'denied' : 'unknown')
      })
      .catch(() => {})
  }, [])

  // Update elapsed timer
  useEffect(() => {
    if (!status?.activeShift) { setElapsed(''); return }
    const update = () => {
      const diff = Date.now() - new Date(status.activeShift!.clock_in_at).getTime()
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setElapsed(`${h > 0 ? h + 'h ' : ''}${m}m ${s}s`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [status?.activeShift])

  // Break elapsed timer
  useEffect(() => {
    if (!status?.activeBreak) { setBreakElapsed(''); return }
    const update = () => {
      const diff = Date.now() - new Date(status.activeBreak!.break_start).getTime()
      const m = Math.floor(diff / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setBreakElapsed(`${m}m ${s}s`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [status?.activeBreak])

  // GPS breadcrumb tracking while clocked in
  useEffect(() => {
    if (!status?.activeShift) return
    const sendBreadcrumb = () => {
      if (!navigator.geolocation) return
      navigator.geolocation.getCurrentPosition(pos => {
        fetch('/api/gps/breadcrumb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        }).catch(() => {})
      }, () => { /* GPS unavailable — skip breadcrumb */ })
    }
    const id = setInterval(sendBreadcrumb, 3 * 60 * 1000)
    return () => clearInterval(id)
  }, [status?.activeShift])

  async function getCoords(): Promise<{ lat: number; lng: number } | null> {
    return new Promise(resolve => {
      if (!navigator.geolocation) { resolve(null); return }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 10000, maximumAge: 0 }
      )
    })
  }

  async function clockIn() {
    // Show prominent disclosure if not yet acknowledged
    if (!localStorage.getItem('fmp_location_disclosure_ack')) {
      setShowDisclosure(true)
      return
    }
    setLoading(true)
    setMessage(null)
    setLocating(true)
    const coords = await getCoords()
    setLocating(false)
    try {
      if (session?.role === 'employee' && !selectedStoreId) {
        setMessage({ text: 'Please select which store you are working at', type: 'error' })
        setLoading(false)
        return
      }
      const res = await fetch('/api/clock/in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: coords?.lat ?? null, lng: coords?.lng ?? null, storeId: selectedStoreId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ text: data.error || 'Failed to clock in', type: 'error' })
      } else {
        setMessage({ text: 'Clocked in successfully', type: 'success' })
        await fetchStatus()
        // Start native background GPS tracking (no-op in browser)
        if (data.shiftId) startNativeTracking(data.shiftId)
        // Show "Always Allow" guidance once for iOS native users
        if (isCapacitor() && !localStorage.getItem('fmp_location_guide_dismissed')) {
          setShowAlwaysBanner(true)
        }
      }
    } catch {
      setMessage({ text: 'Network error', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function clockOut() {
    setLoading(true)
    setMessage(null)
    setLocating(true)
    const coords = await getCoords()
    setLocating(false)
    try {
      const res = await fetch('/api/clock/out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: coords?.lat ?? null, lng: coords?.lng ?? null, handoffNote: handoffNote.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ text: data.error || 'Failed to clock out', type: 'error' })
      } else {
        setMessage({ text: 'Clocked out successfully', type: 'success' })
        stopNativeTracking()
        await fetchStatus()
      }
    } catch {
      setMessage({ text: 'Network error', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function toggleBreak() {
    setBreakLoading(true)
    setMessage(null)
    const onBreak = !!status?.activeBreak
    try {
      const res = await fetch('/api/clock/break', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: onBreak ? 'end' : 'start' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ text: data.error || 'Failed to update break', type: 'error' })
      } else {
        setMessage({ text: onBreak ? 'Break ended — welcome back!' : 'Break started', type: 'success' })
        await fetchStatus()
      }
    } catch {
      setMessage({ text: 'Network error', type: 'error' })
    } finally {
      setBreakLoading(false)
    }
  }

  const clocked = !!status?.activeShift
  const onBreak = !!status?.activeBreak

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14 flex flex-col">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      {/* Prominent location disclosure modal — shown once before first clock-in */}
      {showDisclosure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
          <div className="bg-gray-900 border border-violet-700/60 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-violet-600/20 border border-violet-600/40 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h2 className="text-white font-bold text-base">Background Location Required</h2>
            </div>
            <p className="text-gray-200 text-sm font-semibold leading-relaxed mb-3">
              Field Manager Pro collects location data to verify your clock-in location and track your work shift route, even when the app is closed or not in use.
            </p>
            <ul className="text-gray-400 text-xs space-y-2 mb-4 pl-1">
              <li className="flex gap-2"><span className="text-violet-400 mt-0.5">•</span><span>Background location is collected continuously while you have an active shift</span></li>
              <li className="flex gap-2"><span className="text-violet-400 mt-0.5">•</span><span>Tracking stops automatically when you clock out</span></li>
              <li className="flex gap-2"><span className="text-violet-400 mt-0.5">•</span><span>Location data is shared only with your employer and is never sold</span></li>
            </ul>
            <p className="text-gray-500 text-xs mb-5">
              See our{' '}
              <a
                href="https://fieldmanagerpro.app/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-violet-400 underline"
              >
                Privacy Policy
              </a>{' '}for full details on how location data is collected and used.
            </p>
            <button
              onClick={() => {
                localStorage.setItem('fmp_location_disclosure_ack', '1')
                setShowDisclosure(false)
                clockIn()
              }}
              className="w-full bg-violet-600 hover:bg-violet-500 text-white font-bold py-3 rounded-xl text-sm transition-colors"
            >
              I Understand — Continue
            </button>
            <button
              onClick={() => setShowDisclosure(false)}
              className="w-full mt-2 bg-gray-800 hover:bg-gray-700 text-gray-400 font-semibold py-2.5 rounded-xl text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center px-4 max-w-sm mx-auto w-full">
        {/* Status circle */}
        <div className={`w-52 h-52 rounded-full flex flex-col items-center justify-center border-4 mb-4 transition-colors ${
          onBreak ? 'border-amber-500 bg-amber-950' : clocked ? 'border-green-500 bg-green-950' : 'border-gray-700 bg-gray-900'
        }`}>
          {clocked ? (
            <>
              <p className={`font-semibold text-sm ${onBreak ? 'text-amber-400' : 'text-green-400'}`}>
                {onBreak ? 'ON BREAK' : 'CLOCKED IN'}
              </p>
              <p className="text-white font-mono text-2xl font-bold mt-1">
                {onBreak ? breakElapsed : elapsed}
              </p>
              {!onBreak && status?.activeShift?.store_address && (
                <p className="text-green-300 text-xs mt-1 px-4 text-center leading-tight font-medium">
                  {status.activeShift.store_address.split(',')[0]}
                </p>
              )}
              {onBreak && (
                <p className="text-amber-600 text-xs mt-1 px-4 text-center">Unpaid · max 45 min</p>
              )}
              {!onBreak && status?.activeShift?.clock_in_address && (
                <p className="text-gray-500 text-xs mt-1 px-4 text-center leading-tight">
                  {status.activeShift.clock_in_address}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-gray-400 font-semibold text-sm">NOT CLOCKED IN</p>
              {status && !status.scheduledToday && (
                <p className="text-amber-400 text-xs mt-2 px-4 text-center">Not scheduled today</p>
              )}
            </>
          )}
        </div>

        {/* Break button — shown when clocked in */}
        {clocked && !confirmingClockOut && (
          <button
            onClick={toggleBreak}
            disabled={breakLoading}
            className={`w-full py-3 rounded-2xl font-semibold text-sm transition-colors mb-4 disabled:opacity-50 ${
              onBreak
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-gray-800 hover:bg-gray-700 text-amber-400 border border-amber-800/50'
            }`}
          >
            {breakLoading ? 'Processing…' : onBreak ? 'End Break' : 'Take Break'}
          </button>
        )}

        {/* Message */}
        {message && (
          <div className={`w-full mb-4 px-4 py-3 rounded-xl text-sm font-medium ${
            message.type === 'success' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
          }`}>
            {message.text}
          </div>
        )}

        {/* GPS Status */}
        {gpsStatus === 'denied' && (
          <div className="w-full mb-4 px-4 py-3 rounded-xl bg-amber-900/40 border border-amber-700 text-amber-300 text-sm">
            <p className="font-semibold mb-1">⚠️ Location access is blocked</p>
            <p className="text-xs text-amber-400">GPS tracking is required for shift tracking. To fix: open your browser settings, find this site under Permissions, and set Location to Allow.</p>
          </div>
        )}
        {gpsStatus === 'unavailable' && (
          <div className="w-full mb-4 px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 text-sm">
            <p className="text-xs">GPS is not available on this device.</p>
          </div>
        )}

        {/* iOS "Always Allow" location guidance */}
        {showAlwaysBanner && (
          <div className="w-full mb-4 px-4 py-3 rounded-xl bg-blue-900/40 border border-blue-700 text-blue-200 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-blue-100 mb-1">Enable background location</p>
                <p className="text-xs text-blue-300 leading-relaxed">
                  For route tracking while the app is in the background, go to{' '}
                  <span className="font-medium text-blue-100">Settings → Field Manager Pro → Location</span>{' '}
                  and select <span className="font-medium text-blue-100">Always</span>.
                </p>
              </div>
              <button
                onClick={() => {
                  localStorage.setItem('fmp_location_guide_dismissed', '1')
                  setShowAlwaysBanner(false)
                }}
                className="text-blue-400 hover:text-blue-200 text-lg leading-none flex-shrink-0 mt-0.5"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Store picker — employees only, only shown when not clocked in */}
        {!clocked && session?.role === 'employee' && (
          <div className="w-full mb-4">
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wide">
              Which store are you working?
            </label>
            {stores.length === 0 ? (
              <p className="text-xs text-amber-400 bg-amber-900/30 border border-amber-700 rounded-xl px-4 py-3">
                No stores assigned. Contact your manager.
              </p>
            ) : (
              <select
                value={selectedStoreId}
                onChange={e => setSelectedStoreId(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 text-gray-200 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500">
                <option value="">— Select a store —</option>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.address}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Clock-out confirmation */}
        {confirmingClockOut && (
          <div className="w-full mb-4 bg-gray-900 border border-red-700 rounded-2xl p-4">
            <p className="text-white font-semibold text-sm mb-1">Clock out?</p>
            <p className="text-gray-400 text-xs mb-3">Your shift will be ended and your time recorded.</p>
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Handoff note for your manager <span className="normal-case font-normal text-gray-600">(optional)</span>
              </label>
              <textarea
                value={handoffNote}
                onChange={e => setHandoffNote(e.target.value)}
                placeholder="Anything your manager should know about your shift…"
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setConfirmingClockOut(false); clockOut() }}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
              >
                Clock Out
              </button>
              <button
                onClick={() => { setConfirmingClockOut(false); setHandoffNote('') }}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Action button */}
        <button
          onClick={clocked ? () => setConfirmingClockOut(true) : clockIn}
          disabled={loading || !status || confirmingClockOut || onBreak}
          className={`w-full py-4 rounded-2xl font-bold text-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            clocked
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-violet-600 hover:bg-violet-500 text-white'
          }`}
        >
          {loading ? (locating ? 'Getting Location…' : 'Processing…') : clocked ? 'Clock Out' : 'Clock In'}
        </button>
        {onBreak && (
          <p className="text-xs text-amber-600 mt-2 text-center">End your break before clocking out</p>
        )}

        <p className="text-xs text-gray-600 mt-3 text-center">
          GPS location is captured automatically
        </p>

        {/* Today's schedule */}
        {status?.todayShifts && status.todayShifts.length > 0 && (
          <div className="w-full mt-6">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Today's Schedule</p>
            <div className="space-y-2">
              {status.todayShifts.map((shift, i) => {
                const fmt = (t: string) => {
                  const [h, m] = t.split(':').map(Number)
                  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
                }
                return (
                  <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-white font-semibold text-sm">{fmt(shift.start_time)} – {fmt(shift.end_time)}</p>
                      {shift.break_minutes > 0 && (
                        <span className="text-xs text-gray-500">{shift.break_minutes}m break</span>
                      )}
                    </div>
                    <p className="text-gray-400 text-xs mt-0.5 truncate">{shift.store_address}</p>
                    {shift.role_note && (
                      <p className="text-violet-400 text-xs mt-0.5">{shift.role_note}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
