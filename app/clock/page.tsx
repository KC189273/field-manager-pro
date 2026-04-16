'use client'

import { useState, useEffect, useCallback } from 'react'
import NavBar from '@/components/NavBar'
import { startNativeTracking, stopNativeTracking } from '@/lib/gps-native'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface ClockStatus {
  activeShift: {
    id: string
    clock_in_at: string
    clock_in_address: string | null
  } | null
  scheduledToday: boolean
}

export default function ClockPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<ClockStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [elapsed, setElapsed] = useState('')
  const [locating, setLocating] = useState(false)
  const [gpsStatus, setGpsStatus] = useState<'unknown' | 'granted' | 'denied' | 'unavailable'>('unknown')

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
      }, () => {
        fetch('/api/gps/breadcrumb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: null, lng: null }),
        }).catch(() => {})
      })
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
    setLoading(true)
    setMessage(null)
    setLocating(true)
    const coords = await getCoords()
    setLocating(false)
    try {
      const res = await fetch('/api/clock/in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: coords?.lat ?? null, lng: coords?.lng ?? null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ text: data.error || 'Failed to clock in', type: 'error' })
      } else {
        setMessage({ text: 'Clocked in successfully', type: 'success' })
        await fetchStatus()
        // Start native background GPS tracking (no-op in browser)
        if (data.shiftId) startNativeTracking(data.shiftId)
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
        body: JSON.stringify({ lat: coords?.lat ?? null, lng: coords?.lng ?? null }),
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

  const clocked = !!status?.activeShift

  return (
    <div className="min-h-screen bg-gray-950 pb-20 pt-14 flex flex-col">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <div className="flex-1 flex flex-col items-center justify-center px-4 max-w-sm mx-auto w-full">
        {/* Status circle */}
        <div className={`w-52 h-52 rounded-full flex flex-col items-center justify-center border-4 mb-8 transition-colors ${
          clocked ? 'border-green-500 bg-green-950' : 'border-gray-700 bg-gray-900'
        }`}>
          {clocked ? (
            <>
              <p className="text-green-400 font-semibold text-sm">CLOCKED IN</p>
              <p className="text-white font-mono text-2xl font-bold mt-1">{elapsed}</p>
              {status?.activeShift?.clock_in_address && (
                <p className="text-gray-400 text-xs mt-2 px-4 text-center leading-tight">
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

        {/* Action button */}
        <button
          onClick={clocked ? clockOut : clockIn}
          disabled={loading || !status}
          className={`w-full py-4 rounded-2xl font-bold text-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            clocked
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-violet-600 hover:bg-violet-500 text-white'
          }`}
        >
          {loading ? (locating ? 'Getting Location…' : 'Processing…') : clocked ? 'Clock Out' : 'Clock In'}
        </button>

        <p className="text-xs text-gray-600 mt-3 text-center">
          GPS location is captured automatically
        </p>
      </div>
    </div>
  )
}
