'use client'

import { useState, useEffect, useRef } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'developer'
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
  full_name: string
}

interface Breadcrumb {
  shift_id: string
  lat: number | null
  lng: number | null
  recorded_at: string
  is_gap: boolean
}

interface User {
  id: string
  full_name: string
}

export default function MapPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [selectedUser, setSelectedUser] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [mapReady, setMapReady] = useState(false)

  const isManager = (role: string) => role === 'manager' || role === 'ops_manager' || role === 'developer'

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(s => {
      setSession(s)
      if (isManager(s.role)) {
        fetch('/api/team/users').then(r => r.json()).then(d => {
          if (d.users) setUsers(d.users.filter((u: { role: string }) => u.role === 'employee'))
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

  async function loadMap() {
    if (!mapRef.current || !mapReady) return

    const params = new URLSearchParams()
    if (selectedUser) params.set('userId', selectedUser)
    if (from) params.set('from', from)
    if (to) params.set('to', to + 'T23:59:59')

    const res = await fetch(`/api/map?${params}`)
    if (!res.ok) return
    const { shifts, breadcrumbs }: { shifts: Shift[]; breadcrumbs: Breadcrumb[] } = await res.json()

    import('mapbox-gl').then(mapboxgl => {
      const map = mapRef.current

      // Remove existing markers
      document.querySelectorAll('.fmp-marker').forEach(el => el.remove())

      const bounds = new mapboxgl.default.LngLatBounds()
      let hasPoints = false

      for (const shift of shifts) {
        // Clock-in marker (green)
        if (shift.clock_in_lat && shift.clock_in_lng) {
          const el = document.createElement('div')
          el.className = 'fmp-marker'
          el.style.cssText = 'width:12px;height:12px;border-radius:50%;background:#22c55e;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.5);'
          new mapboxgl.default.Marker({ element: el })
            .setLngLat([shift.clock_in_lng, shift.clock_in_lat])
            .setPopup(new mapboxgl.default.Popup({ offset: 10 }).setHTML(
              `<div style="font-size:12px;"><strong>${shift.full_name}</strong><br>Clock in: ${new Date(shift.clock_in_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</div>`
            ))
            .addTo(map)
          bounds.extend([shift.clock_in_lng, shift.clock_in_lat])
          hasPoints = true
        }

        // Clock-out marker (red)
        if (shift.clock_out_at && shift.clock_out_lat && shift.clock_out_lng) {
          const el = document.createElement('div')
          el.className = 'fmp-marker'
          el.style.cssText = 'width:12px;height:12px;border-radius:50%;background:#ef4444;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.5);'
          new mapboxgl.default.Marker({ element: el })
            .setLngLat([shift.clock_out_lng, shift.clock_out_lat])
            .setPopup(new mapboxgl.default.Popup({ offset: 10 }).setHTML(
              `<div style="font-size:12px;"><strong>${shift.full_name}</strong><br>Clock out: ${new Date(shift.clock_out_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</div>`
            ))
            .addTo(map)
          bounds.extend([shift.clock_out_lng, shift.clock_out_lat])
          hasPoints = true
        }

        // Breadcrumbs (blue)
        const shiftCrumbs = breadcrumbs.filter(b => b.shift_id === shift.id && b.lat && b.lng && !b.is_gap)
        for (const crumb of shiftCrumbs) {
          const el = document.createElement('div')
          el.className = 'fmp-marker'
          el.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#3b82f6;border:1.5px solid white;box-shadow:0 0 3px rgba(0,0,0,0.4);'
          new mapboxgl.default.Marker({ element: el })
            .setLngLat([crumb.lng!, crumb.lat!])
            .setPopup(new mapboxgl.default.Popup({ offset: 8 }).setHTML(
              `<div style="font-size:12px;"><strong>${shift.full_name}</strong><br>${new Date(crumb.recorded_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago' })}</div>`
            ))
            .addTo(map)
          bounds.extend([crumb.lng!, crumb.lat!])
          hasPoints = true
        }
      }

      if (hasPoints && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 15 })
      }
    })

    setLoaded(true)
  }

  useEffect(() => {
    if (mapReady && session) loadMap()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, session])

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col pb-16 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

      {/* Filters */}
      <div className="px-4 py-3 bg-gray-950 border-b border-gray-800 flex flex-wrap gap-2 items-end">
        {session && isManager(session.role) && (
          <select
            value={selectedUser}
            onChange={e => setSelectedUser(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="">All employees</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
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
      </div>

      {/* Legend */}
      <div className="px-4 py-2 bg-gray-900 border-b border-gray-800 flex items-center gap-4">
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 block" /><span className="text-xs text-gray-400">Clock In</span></div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500 block" /><span className="text-xs text-gray-400">Clock Out</span></div>
        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 block" /><span className="text-xs text-gray-400">15-min</span></div>
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
