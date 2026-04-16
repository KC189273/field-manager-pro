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

interface Breadcrumb {
  shift_id: string
  lat: number | null
  lng: number | null
  recorded_at: string
  is_gap: boolean
}

interface LiveEmployee {
  shift_id: string
  user_id: string
  full_name: string
  clock_in_at: string
  lat: number | null
  lng: number | null
  last_seen_at: string
}

interface User {
  id: string
  full_name: string
  role: string
}

const PATH_SOURCE = 'shift-paths'
const PATH_LAYER = 'shift-paths-line'

// Snap a GPS path to roads.
// 2 points → Directions API (clean A→B road route).
// 3+ points → Map Matching API (snaps actual GPS trace to roads).
async function snapToRoads(coords: [number, number][]): Promise<[number, number][]> {
  if (coords.length < 2) return coords
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!
  try {
    if (coords.length === 2) {
      // Directions API — best for just start/end with no intermediate GPS
      const [a, b] = coords
      const res = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${a[0]},${a[1]};${b[0]},${b[1]}?access_token=${token}&geometries=geojson&overview=full`
      )
      if (res.ok) {
        const data = await res.json()
        const route = data.routes?.[0]?.geometry?.coordinates as [number, number][] | undefined
        if (route && route.length >= 2) return route
      }
    } else {
      // Map Matching API — snaps GPS trace to roads (up to 100 pts)
      const MAX = 100
      const pts: [number, number][] = coords.length > MAX
        ? Array.from({ length: MAX }, (_, i) => coords[Math.round(i * (coords.length - 1) / (MAX - 1))])
        : coords
      const coordStr = pts.map(([lng, lat]) => `${lng},${lat}`).join(';')
      const radiuses = pts.map(() => '100').join(';')
      const res = await fetch(
        `https://api.mapbox.com/matching/v5/mapbox/driving/${coordStr}?access_token=${token}&geometries=geojson&radiuses=${radiuses}&overview=full&tidy=true`
      )
      if (res.ok) {
        const data = await res.json()
        if (data.matchings?.length) {
          const all: [number, number][] = []
          for (const m of data.matchings) {
            if (m.geometry?.coordinates?.length) all.push(...(m.geometry.coordinates as [number, number][]))
          }
          if (all.length >= 2) return all
        }
      }
      // Map Matching failed — fall back to Directions API between first and last point
      const [first, last] = [pts[0], pts[pts.length - 1]]
      const fallback = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${first[0]},${first[1]};${last[0]},${last[1]}?access_token=${token}&geometries=geojson&overview=full`
      )
      if (fallback.ok) {
        const fData = await fallback.json()
        const route = fData.routes?.[0]?.geometry?.coordinates as [number, number][] | undefined
        if (route && route.length >= 2) return route
      }
    }
  } catch { /* fall back to straight lines */ }
  return coords
}

export default function MapPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const liveMarkersRef = useRef<any[]>([])
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

  const clearAllMarkers = () => {
    liveMarkersRef.current.forEach(m => { try { m.remove() } catch { /* ignore */ } })
    liveMarkersRef.current = []
    document.querySelectorAll('.fmp-marker, .fmp-live-marker').forEach(el => el.remove())
  }

  const loadLive = useCallback(async () => {
    if (!mapRef.current || !mapReady) return

    const res = await fetch('/api/map/live')
    if (!res.ok) return
    const { employees, breadcrumbs } = await res.json() as {
      employees: LiveEmployee[]
      breadcrumbs: Breadcrumb[]
    }

    // Build road-matched paths for each employee in parallel
    const empWithCoords = employees
      .map(emp => ({ ...emp, lat: Number(emp.lat), lng: Number(emp.lng) }))
      .filter(emp => isFinite(emp.lat) && isFinite(emp.lng) && emp.lat !== 0 && emp.lng !== 0)

    const matchedPaths = await Promise.all(empWithCoords.map(async emp => {
      const crumbs = breadcrumbs.filter(b => b.shift_id === emp.shift_id && !b.is_gap)
      const allPts = ([
        ...crumbs.map(c => ({ lng: Number(c.lng), lat: Number(c.lat), t: new Date(c.recorded_at).getTime() })),
        { lng: emp.lng, lat: emp.lat, t: new Date(emp.last_seen_at).getTime() },
      ]).filter(p => isFinite(p.lat) && isFinite(p.lng) && p.lat !== 0 && p.lng !== 0)

      // Filter out points requiring >200 km/h from the previous point
      const filtered: [number, number][] = []
      for (const pt of allPts) {
        if (filtered.length === 0) { filtered.push([pt.lng, pt.lat]); continue }
        const prev = filtered[filtered.length - 1]
        const R = 6371
        const dLat = (pt.lat - prev[1]) * Math.PI / 180
        const dLng = (pt.lng - prev[0]) * Math.PI / 180
        const a = Math.sin(dLat/2)**2 + Math.cos(prev[1]*Math.PI/180)*Math.cos(pt.lat*Math.PI/180)*Math.sin(dLng/2)**2
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
        if (dist <= 100) filtered.push([pt.lng, pt.lat])
      }

      const coords = filtered.length >= 2 ? await snapToRoads(filtered) : filtered
      return { emp, coords }
    }))

    import('mapbox-gl').then(mapboxgl => {
      const map = mapRef.current

      // Properly remove old live markers via Mapbox API
      liveMarkersRef.current.forEach(m => { try { m.remove() } catch { /* ignore */ } })
      liveMarkersRef.current = []
      document.querySelectorAll('.fmp-live-marker').forEach(el => el.remove())

      // Remove existing path layer/source
      if (map.getLayer(PATH_LAYER)) map.removeLayer(PATH_LAYER)
      if (map.getSource(PATH_SOURCE)) map.removeSource(PATH_SOURCE)

      const livePaths = matchedPaths
        .filter(({ coords }) => coords.length >= 2)
        .map(({ emp, coords }) => ({
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: coords },
          properties: { name: emp.full_name },
        }))

      map.addSource(PATH_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: livePaths },
      })
      map.addLayer({
        id: PATH_LAYER,
        type: 'line',
        source: PATH_SOURCE,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#22c55e', 'line-width': 3, 'line-opacity': 0.8 },
      })

      const bounds = new mapboxgl.default.LngLatBounds()
      let hasPoints = false

      for (const emp of empWithCoords) {
        // Wrapper element for Mapbox marker
        const wrapper = document.createElement('div')
        wrapper.className = 'fmp-live-marker'
        wrapper.style.cssText = 'position:relative;width:28px;height:28px;'

        // Pulsing ring
        const ring = document.createElement('div')
        ring.style.cssText = `
          width:28px;height:28px;border-radius:50%;
          background:rgba(34,197,94,0.2);border:2px solid rgba(34,197,94,0.6);
          display:flex;align-items:center;justify-content:center;
          animation:live-pulse 2s ease-in-out infinite;cursor:pointer;
        `
        // Inner dot
        const dot = document.createElement('div')
        dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#22c55e;border:1.5px solid white;box-shadow:0 0 6px rgba(34,197,94,0.8);'
        ring.appendChild(dot)

        // Name label — sibling of ring, not child
        const label = document.createElement('div')
        label.style.cssText = `
          position:absolute;bottom:34px;left:50%;transform:translateX(-50%);
          background:rgba(0,0,0,0.8);color:white;font-size:10px;font-weight:600;
          padding:2px 6px;border-radius:4px;white-space:nowrap;pointer-events:none;
        `
        label.textContent = emp.full_name.split(' ')[0]

        wrapper.appendChild(label)
        wrapper.appendChild(ring)

        const clockIn = new Date(emp.clock_in_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
        const lastSeen = new Date(emp.last_seen_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })

        const marker = new mapboxgl.default.Marker({ element: wrapper, anchor: 'bottom' })
          .setLngLat([emp.lng, emp.lat])
          .setPopup(new mapboxgl.default.Popup({ offset: 16 }).setHTML(`
            <div style="font-size:13px;line-height:1.6">
              <div style="font-weight:700;font-size:14px;margin-bottom:6px;color:#f9fafb">${emp.full_name}</div>
              <div style="color:#4ade80;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">● Live</div>
              <div style="color:#d1d5db"><span style="color:#9ca3af">Clocked in:</span> ${clockIn}</div>
              <div style="color:#d1d5db"><span style="color:#9ca3af">Last ping:</span> ${lastSeen}</div>
            </div>
          `))
          .addTo(map)

        liveMarkersRef.current.push(marker)
        bounds.extend([emp.lng, emp.lat])
        hasPoints = true
      }

      if (hasPoints && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 80, maxZoom: 15 })
      }

      setLiveCount(empWithCoords.length)
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
    const { shifts, breadcrumbs }: { shifts: Shift[]; breadcrumbs: Breadcrumb[] } = await res.json()

    import('mapbox-gl').then(async mapboxgl => {
      const map = mapRef.current

      // Remove all markers
      clearAllMarkers()

      // Remove existing path layer/source
      if (map.getLayer(PATH_LAYER)) map.removeLayer(PATH_LAYER)
      if (map.getSource(PATH_SOURCE)) map.removeSource(PATH_SOURCE)

      const bounds = new mapboxgl.default.LngLatBounds()
      let hasPoints = false

      // Build road-snapped path for each shift in parallel.
      // Requires at least clock_in + one other point (breadcrumb or clock_out).
      // Shifts with only clock_in get a dot but no line.
      const rawPaths = shifts.map(shift => {
        const coords: [number, number][] = []
        if (shift.clock_in_lat && shift.clock_in_lng)
          coords.push([shift.clock_in_lng, shift.clock_in_lat])
        const crumbs = breadcrumbs.filter(b => b.shift_id === shift.id && b.lat && b.lng && !b.is_gap)
        for (const c of crumbs) coords.push([c.lng!, c.lat!])
        if (shift.clock_out_lat && shift.clock_out_lng)
          coords.push([shift.clock_out_lng, shift.clock_out_lat])
        return { shift, coords }
      }).filter(({ coords }) => coords.length >= 2)

      const pathFeatures = await Promise.all(rawPaths.map(async ({ shift, coords }) => {
        const snapped = await snapToRoads(coords)
        return {
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: snapped },
          properties: { name: shift.full_name },
        }
      }))

      map.addSource(PATH_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: pathFeatures },
      })
      map.addLayer({
        id: PATH_LAYER,
        type: 'line',
        source: PATH_SOURCE,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#818cf8', 'line-width': 3, 'line-opacity': 0.8 },
      })

      for (const shift of shifts) {
        // Clock-in marker (green)
        if (shift.clock_in_lat && shift.clock_in_lng) {
          const el = document.createElement('div')
          el.className = 'fmp-marker'
          el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#22c55e;border:2.5px solid white;box-shadow:0 0 6px rgba(34,197,94,0.5);cursor:pointer;'
          new mapboxgl.default.Marker({ element: el })
            .setLngLat([shift.clock_in_lng, shift.clock_in_lat])
            .setPopup(new mapboxgl.default.Popup({ offset: 10 }).setHTML(`
              <div style="font-size:13px;line-height:1.6">
                <div style="font-weight:700;font-size:14px;margin-bottom:6px;color:#f9fafb">${shift.full_name}</div>
                <div style="color:#4ade80;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Clock In</div>
                <div style="color:#d1d5db">${new Date(shift.clock_in_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</div>
                ${shift.clock_in_address ? `<div style="color:#9ca3af;font-size:11px;margin-top:4px">${shift.clock_in_address}</div>` : ''}
              </div>
            `))
            .addTo(map)
          bounds.extend([shift.clock_in_lng, shift.clock_in_lat])
          hasPoints = true
        }

        // Clock-out marker (red)
        if (shift.clock_out_at && shift.clock_out_lat && shift.clock_out_lng) {
          const el = document.createElement('div')
          el.className = 'fmp-marker'
          el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#ef4444;border:2.5px solid white;box-shadow:0 0 6px rgba(239,68,68,0.5);cursor:pointer;'
          new mapboxgl.default.Marker({ element: el })
            .setLngLat([shift.clock_out_lng, shift.clock_out_lat])
            .setPopup(new mapboxgl.default.Popup({ offset: 10 }).setHTML(`
              <div style="font-size:13px;line-height:1.6">
                <div style="font-weight:700;font-size:14px;margin-bottom:6px;color:#f9fafb">${shift.full_name}</div>
                <div style="color:#f87171;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Clock Out</div>
                <div style="color:#d1d5db">${new Date(shift.clock_out_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</div>
                ${shift.clock_out_address ? `<div style="color:#9ca3af;font-size:11px;margin-top:4px">${shift.clock_out_address}</div>` : ''}
              </div>
            `))
            .addTo(map)
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

  // Toggle live mode
  const toggleLive = useCallback(() => {
    setLiveMode(prev => {
      const next = !prev
      if (next) {
        // Switching to live — clear historical markers
        clearAllMarkers()
        if (mapRef.current?.getLayer(PATH_LAYER)) mapRef.current.removeLayer(PATH_LAYER)
        if (mapRef.current?.getSource(PATH_SOURCE)) mapRef.current.removeSource(PATH_SOURCE)
      } else {
        // Switching off live — clear live markers, stop interval
        document.querySelectorAll('.fmp-live-marker').forEach(el => el.remove())
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

  // Start/stop polling when liveMode changes
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

  // Format "updated X ago"
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

      {/* Pulse animation + popup styles */}
      <style>{`
        @keyframes live-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.35); opacity: 0.6; }
        }
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
        {/* Live toggle — managers+ only */}
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

        {/* Historical filters — hidden in live mode */}
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

        {/* Live status badge */}
        {liveMode && lastUpdated && (
          <div className="flex items-center gap-2 ml-1">
            <span className="text-xs text-green-400 font-medium">
              ● LIVE · {liveCount} clocked in · updated {updatedAgo}
            </span>
          </div>
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
            <div className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-green-500 block" style={{ boxShadow: '0 0 6px rgba(34,197,94,0.5)' }} /><span className="text-xs text-gray-400">Clock In</span></div>
            <div className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-red-500 block" style={{ boxShadow: '0 0 6px rgba(239,68,68,0.5)' }} /><span className="text-xs text-gray-400">Clock Out</span></div>
            <div className="flex items-center gap-1.5"><span className="w-8 h-0.5 bg-indigo-400 block rounded" style={{ height: '3px' }} /><span className="text-xs text-gray-400">Traveled Route</span></div>
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
