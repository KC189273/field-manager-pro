'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'rdm' | 'developer'
}

interface Shift {
  id: string
  clock_in_at: string
  clock_in_lat: number | null
  clock_in_lng: number | null
  clock_in_address: string | null
  clock_out_at: string | null
  clock_out_lat: number | null
  clock_out_lng: number | null
  clock_out_address: string | null
  full_name: string
}

interface LiveEmployee {
  shift_id: string
  user_id: string
  full_name: string
  clock_in_at: string
  clock_in_lat: number | null
  clock_in_lng: number | null
  lat: number | null
  lng: number | null
  last_seen_at: string
}

interface User {
  id: string
  full_name: string
  role: string
}

export default function MapPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([])
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [selectedUser, setSelectedUser] = useState('')
  const [from, setFrom] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [to, setTo] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [loaded, setLoaded] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [liveMode, setLiveMode] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [liveCount, setLiveCount] = useState(0)

  const canViewAll = (role: string) =>
    role === 'manager' || role === 'ops_manager' || role === 'owner' || role === 'sales_director' || role === 'developer'

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(s => {
      setSession(s)
      if (canViewAll(s.role)) {
        fetch('/api/team/users').then(r => r.json()).then(d => {
          if (d.users) setUsers(d.users)
        })
      }
    })
  }, [])

  // Initialize Mapbox
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    import('mapbox-gl').then(mapboxgl => {
      mapboxgl.default.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!
      const map = new mapboxgl.default.Map({
        container: mapContainerRef.current!,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [-90.2, 38.6],
        zoom: 9,
      })
      mapRef.current = map
      map.on('load', () => setMapReady(true))
    })
  }, [])

  const clearMarkers = () => {
    markersRef.current.forEach(m => { try { m.remove() } catch { /* ignore */ } })
    markersRef.current = []
  }

  function makeLabel(name: string, color: string) {
    const el = document.createElement('div')
    el.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;'

    const label = document.createElement('div')
    label.style.cssText = `
      background:rgba(0,0,0,0.75);color:#f9fafb;font-size:10px;font-weight:600;
      padding:2px 6px;border-radius:4px;white-space:nowrap;pointer-events:none;
    `
    label.textContent = name

    const dot = document.createElement('div')
    dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 6px ${color}88;`

    el.appendChild(label)
    el.appendChild(dot)
    return el
  }

  const loadLive = useCallback(async () => {
    if (!mapRef.current || !mapReady) return

    const res = await fetch('/api/map/live')
    if (!res.ok) return
    const { employees } = await res.json() as { employees: LiveEmployee[] }

    import('mapbox-gl').then(mapboxgl => {
      const map = mapRef.current
      clearMarkers()

      const bounds = new mapboxgl.default.LngLatBounds()
      let hasPoints = false

      for (const emp of employees) {
        const lat = Number(emp.lat)
        const lng = Number(emp.lng)
        if (!isFinite(lat) || !isFinite(lng) || lat === 0 || lng === 0) continue

        const clockIn = new Date(emp.clock_in_at).toLocaleTimeString('en-US', {
          timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit',
        })
        const lastSeen = new Date(emp.last_seen_at).toLocaleTimeString('en-US', {
          timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit',
        })

        const el = makeLabel(emp.full_name.split(' ')[0], '#22c55e')

        const marker = new mapboxgl.default.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([lng, lat])
          .setPopup(new mapboxgl.default.Popup({ offset: 14 }).setHTML(`
            <div style="font-size:13px;line-height:1.6">
              <div style="font-weight:700;font-size:14px;margin-bottom:6px;color:#f9fafb">${emp.full_name}</div>
              <div style="color:#4ade80;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">● Live</div>
              <div style="color:#d1d5db"><span style="color:#9ca3af">Clocked in:</span> ${clockIn}</div>
              <div style="color:#d1d5db"><span style="color:#9ca3af">Last ping:</span> ${lastSeen}</div>
            </div>
          `))
          .addTo(map)

        markersRef.current.push(marker)
        bounds.extend([lng, lat])
        hasPoints = true
      }

      if (hasPoints && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 80, maxZoom: 15 })
      }

      setLiveCount(employees.filter(e => {
        const lat = Number(e.lat); const lng = Number(e.lng)
        return isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0
      }).length)
      setLastUpdated(new Date())
    })
  }, [mapReady])

  async function loadMap() {
    if (!mapRef.current || !mapReady) return

    const params = new URLSearchParams()
    if (selectedUser) params.set('userId', selectedUser)
    if (from) params.set('from', from)
    if (to) params.set('to', to + 'T23:59:59')

    const res = await fetch(`/api/map?${params}`)
    if (!res.ok) return
    const { shifts }: { shifts: Shift[] } = await res.json()

    import('mapbox-gl').then(mapboxgl => {
      const map = mapRef.current
      clearMarkers()

      const bounds = new mapboxgl.default.LngLatBounds()
      let hasPoints = false

      for (const shift of shifts) {
        // Clock-in marker (green)
        if (shift.clock_in_lat && shift.clock_in_lng) {
          const el = makeLabel(shift.full_name, '#22c55e')
          const marker = new mapboxgl.default.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([shift.clock_in_lng, shift.clock_in_lat])
            .setPopup(new mapboxgl.default.Popup({ offset: 14 }).setHTML(`
              <div style="font-size:13px;line-height:1.6">
                <div style="font-weight:700;font-size:14px;margin-bottom:6px;color:#f9fafb">${shift.full_name}</div>
                <div style="color:#4ade80;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Clock In</div>
                <div style="color:#d1d5db">${new Date(shift.clock_in_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</div>
                ${shift.clock_in_address ? `<div style="color:#9ca3af;font-size:11px;margin-top:4px">${shift.clock_in_address}</div>` : ''}
              </div>
            `))
            .addTo(map)
          markersRef.current.push(marker)
          bounds.extend([shift.clock_in_lng, shift.clock_in_lat])
          hasPoints = true
        }

        // Clock-out marker (red)
        if (shift.clock_out_at && shift.clock_out_lat && shift.clock_out_lng) {
          const el = makeLabel(shift.full_name, '#ef4444')
          const marker = new mapboxgl.default.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([shift.clock_out_lng, shift.clock_out_lat])
            .setPopup(new mapboxgl.default.Popup({ offset: 14 }).setHTML(`
              <div style="font-size:13px;line-height:1.6">
                <div style="font-weight:700;font-size:14px;margin-bottom:6px;color:#f9fafb">${shift.full_name}</div>
                <div style="color:#f87171;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Clock Out</div>
                <div style="color:#d1d5db">${new Date(shift.clock_out_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</div>
                ${shift.clock_out_address ? `<div style="color:#9ca3af;font-size:11px;margin-top:4px">${shift.clock_out_address}</div>` : ''}
              </div>
            `))
            .addTo(map)
          markersRef.current.push(marker)
          bounds.extend([shift.clock_out_lng, shift.clock_out_lat])
          hasPoints = true
        }
      }

      if (hasPoints && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 15 })
      }
    })

    setLoaded(true)
  }

  const toggleLive = useCallback(() => {
    setLiveMode(prev => {
      const next = !prev
      if (!next) {
        clearMarkers()
        if (liveIntervalRef.current) {
          clearInterval(liveIntervalRef.current)
          liveIntervalRef.current = null
        }
        setLastUpdated(null)
        setLiveCount(0)
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (liveMode && mapReady) {
      loadLive()
      liveIntervalRef.current = setInterval(loadLive, 30_000)
    }
    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current)
        liveIntervalRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode, mapReady])

  useEffect(() => {
    if (mapReady && session) loadMap()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, session])

  const updatedAgo = lastUpdated
    ? (() => {
        const secs = Math.floor((Date.now() - lastUpdated.getTime()) / 1000)
        if (secs < 60) return `${secs}s ago`
        return `${Math.floor(secs / 60)}m ago`
      })()
    : null

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col pb-16 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      <style>{`
        .mapboxgl-popup-content {
          background: #1f2937 !important;
          color: #f9fafb !important;
          border: 1px solid #374151 !important;
          border-radius: 10px !important;
          padding: 10px 14px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
          min-width: 180px;
        }
        .mapboxgl-popup-tip {
          border-top-color: #1f2937 !important;
          border-bottom-color: #1f2937 !important;
        }
        .mapboxgl-popup-close-button {
          color: #9ca3af !important;
          font-size: 16px !important;
          padding: 4px 8px !important;
        }
        .mapboxgl-popup-close-button:hover {
          color: #f9fafb !important;
          background: transparent !important;
        }
      `}</style>

      {/* Filters */}
      <div className="px-4 py-3 bg-gray-950 border-b border-gray-800 flex flex-wrap gap-2 items-end">
        {session && canViewAll(session.role) && (
          <button
            onClick={toggleLive}
            className={`text-sm font-semibold px-4 py-2 rounded-xl transition-colors flex items-center gap-1.5 ${
              liveMode
                ? 'bg-green-600 hover:bg-green-500 text-white'
                : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${liveMode ? 'bg-white animate-pulse' : 'bg-gray-500'}`} />
            Live
          </button>
        )}

        {!liveMode && (
          <>
            {session && canViewAll(session.role) && (
              <select
                value={selectedUser}
                onChange={e => setSelectedUser(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">All employees</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            )}
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            <button onClick={loadMap}
              className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors">
              Load
            </button>
          </>
        )}

        {liveMode && lastUpdated && (
          <span className="text-xs text-green-400 font-medium ml-1">
            ● LIVE · {liveCount} clocked in · updated {updatedAgo}
          </span>
        )}
        {liveMode && !lastUpdated && (
          <span className="text-xs text-gray-500">Loading…</span>
        )}
      </div>

      {/* Legend */}
      <div className="px-4 py-2 bg-gray-900 border-b border-gray-800 flex items-center gap-4">
        {liveMode ? (
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-green-500 block" style={{ boxShadow: '0 0 6px rgba(34,197,94,0.8)' }} />
            <span className="text-xs text-gray-400">Currently clocked in</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-green-500 block" style={{ boxShadow: '0 0 6px rgba(34,197,94,0.5)' }} />
              <span className="text-xs text-gray-400">Clock In</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500 block" style={{ boxShadow: '0 0 6px rgba(239,68,68,0.5)' }} />
              <span className="text-xs text-gray-400">Clock Out</span>
            </div>
          </>
        )}
      </div>

      {/* Map */}
      <div ref={mapContainerRef} className="flex-1" style={{ minHeight: 'calc(100vh - 240px)' }} />

      {!loaded && !mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80">
          <p className="text-gray-400">Loading map…</p>
        </div>
      )}
    </div>
  )
}
