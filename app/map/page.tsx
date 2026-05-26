'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import NavBar from '@/components/NavBar'

interface Session {
  id: string
  fullName: string
  role: 'employee' | 'manager' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'
}

interface Shift {
  id: string
  user_id: string
  user_role: string
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
  lat: number
  lng: number
  recorded_at: string
  is_gap?: boolean
}

interface LiveEmployee {
  shift_id: string
  user_id: string
  full_name: string
  user_role: string
  clock_in_at: string
  lat: number | null
  lng: number | null
  last_seen_at: string
}

interface GpsStop {
  shift_id: string
  lat: number
  lng: number
  arrived_at: string
  departed_at: string | null
  store_name: string | null
}

interface StoreLocation {
  id: string
  address: string
  lat: number
  lng: number
}

interface User {
  id: string
  full_name: string
  role: string
}

const PATH_SOURCE = 'shift-paths'
const PATH_LAYER = 'shift-paths-line'
const HEAT_SOURCE = 'heat-source'
const HEAT_LAYER = 'heat-layer'

async function snapToRoads(coords: [number, number][]): Promise<[number, number][]> {
  if (coords.length < 2) return coords
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!
  try {
    if (coords.length === 2) {
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

const canSeePaths = (role: string) =>
  ['sales_director', 'ops_manager', 'owner', 'developer'].includes(role)

export default function MapPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const replayMarkerRef = useRef<any>(null)
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [session, setSession] = useState<Session | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [selectedUser, setSelectedUser] = useState('')
  const [from, setFrom] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [to, setTo] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [loaded, setLoaded] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [liveMode, setLiveMode] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [liveCount, setLiveCount] = useState(0)

  // Heat map
  const [heatMapMode, setHeatMapMode] = useState(false)
  const heatCrumbsRef = useRef<Breadcrumb[]>([])

  // Route replay
  const [replayBreadcrumbs, setReplayBreadcrumbs] = useState<Breadcrumb[]>([])
  const [isReplaying, setIsReplaying] = useState(false)
  const [replayIdx, setReplayIdx] = useState(0)
  const [replaySpeed, setReplaySpeed] = useState(30)
  const replayIdxRef = useRef(0)
  const replayBreadcrumbsRef = useRef<Breadcrumb[]>([])

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

  // Initialize Mapbox — centered on Milwaukee, WI
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    import('mapbox-gl').then(mapboxgl => {
      mapboxgl.default.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!
      const map = new mapboxgl.default.Map({
        container: mapContainerRef.current!,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [-87.9065, 43.0389],
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

  const clearPaths = () => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer(PATH_LAYER)) map.removeLayer(PATH_LAYER)
    if (map.getSource(PATH_SOURCE)) map.removeSource(PATH_SOURCE)
  }

  const clearHeat = () => {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer(HEAT_LAYER)) map.removeLayer(HEAT_LAYER)
    if (map.getSource(HEAT_SOURCE)) map.removeSource(HEAT_SOURCE)
  }

  function makeMarkerEl(name: string, color: string) {
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

  function makeStopMarkerEl() {
    const el = document.createElement('div')
    el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#a855f7;border:2px solid white;box-shadow:0 0 8px #a855f7aa;cursor:pointer;'
    return el
  }

  function makeStoreMarkerEl(_shortAddr: string) {
    const el = document.createElement('div')
    el.style.cssText = 'cursor:pointer;'
    const dot = document.createElement('div')
    dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#0ea5e9;border:2px solid white;box-shadow:0 0 5px #0ea5e9aa;'
    el.appendChild(dot)
    return el
  }

  function stopPopupHtml(name: string, stop: GpsStop) {
    const tz = 'America/Chicago'
    const fmt = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
    const arrivedStr = fmt(stop.arrived_at)
    const departedStr = stop.departed_at ? fmt(stop.departed_at) : 'Still here'
    const endMs = stop.departed_at ? new Date(stop.departed_at).getTime() : Date.now()
    const totalMins = Math.round((endMs - new Date(stop.arrived_at).getTime()) / 60000)
    const durationStr = totalMins >= 60
      ? `${Math.floor(totalMins / 60)}h ${totalMins % 60}m`
      : `${totalMins}m`
    const storeRow = stop.store_name
      ? `<div style="color:#38bdf8;font-size:11px;margin-top:4px">📍 ${stop.store_name.split(',')[0]}</div>`
      : ''
    return `
      <div style="font-size:13px;line-height:1.6">
        <div style="font-weight:700;font-size:14px;margin-bottom:6px;color:#f9fafb">${name}</div>
        <div style="color:#c084fc;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">● Stop</div>
        <div style="color:#d1d5db"><span style="color:#9ca3af">Arrived:</span> ${arrivedStr}</div>
        <div style="color:#d1d5db"><span style="color:#9ca3af">Left:</span> ${departedStr}</div>
        <div style="color:#d1d5db"><span style="color:#9ca3af">Duration:</span> ${durationStr}</div>
        ${storeRow}
      </div>
    `
  }

  // ── Heat map toggle ───────────────────────────────────────────────
  const toggleHeatMap = useCallback(() => {
    setHeatMapMode(prev => {
      const next = !prev
      const map = mapRef.current
      if (!map) return next

      if (next) {
        // Build heatmap from stored breadcrumbs
        const crumbs = heatCrumbsRef.current.filter(b => !b.is_gap)
        const features = crumbs.map(c => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [Number(c.lng), Number(c.lat)] },
          properties: {},
        }))
        if (map.getSource(HEAT_SOURCE)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(map.getSource(HEAT_SOURCE) as any).setData({ type: 'FeatureCollection', features })
        } else {
          map.addSource(HEAT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features } })
          map.addLayer({
            id: HEAT_LAYER,
            type: 'heatmap',
            source: HEAT_SOURCE,
            paint: {
              'heatmap-weight': 1,
              'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 3],
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0, 'rgba(0,0,255,0)',
                0.2, 'rgba(103,0,255,0.6)',
                0.4, 'rgba(168,0,255,0.7)',
                0.6, 'rgba(220,50,200,0.8)',
                0.8, 'rgba(255,100,100,0.9)',
                1, 'rgba(255,200,0,1)',
              ],
              'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 4, 15, 20],
              'heatmap-opacity': 0.85,
            },
          })
        }
      } else {
        clearHeat()
      }
      return next
    })
  }, [])

  // ── Route replay ──────────────────────────────────────────────────
  const stopReplay = useCallback(() => {
    if (replayTimerRef.current) { clearInterval(replayTimerRef.current); replayTimerRef.current = null }
    if (replayMarkerRef.current) { try { replayMarkerRef.current.remove() } catch { /* */ }; replayMarkerRef.current = null }
    setIsReplaying(false)
    setReplayIdx(0)
    replayIdxRef.current = 0
  }, [])

  const startReplay = useCallback(() => {
    const crumbs = replayBreadcrumbsRef.current.filter(b => !b.is_gap)
    if (crumbs.length < 2) return
    const map = mapRef.current
    if (!map) return

    import('mapbox-gl').then(mapboxgl => {
      // Create replay marker
      const el = document.createElement('div')
      el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#f59e0b;border:2px solid white;box-shadow:0 0 10px #f59e0baa;'
      const marker = new mapboxgl.default.Marker({ element: el, anchor: 'center' })
        .setLngLat([Number(crumbs[0].lng), Number(crumbs[0].lat)])
        .addTo(map)
      replayMarkerRef.current = marker

      replayIdxRef.current = 0
      setReplayIdx(0)
      setIsReplaying(true)

      replayTimerRef.current = setInterval(() => {
        const idx = replayIdxRef.current + 1
        if (idx >= crumbs.length) {
          stopReplay()
          return
        }
        replayIdxRef.current = idx
        setReplayIdx(idx)
        const c = crumbs[idx]
        marker.setLngLat([Number(c.lng), Number(c.lat)])
        map.easeTo({ center: [Number(c.lng), Number(c.lat)], duration: 200 })
      }, 1000 / replaySpeed)
    })
  }, [replaySpeed, stopReplay])

  useEffect(() => {
    replayBreadcrumbsRef.current = replayBreadcrumbs
  }, [replayBreadcrumbs])

  // Cleanup replay on unmount
  useEffect(() => () => stopReplay(), [stopReplay])

  // ── Live map ───────────────────────────────────────────────────────
  const loadLive = useCallback(async () => {
    if (!mapRef.current || !mapReady) return

    const res = await fetch('/api/map/live')
    if (!res.ok) return
    const { employees, breadcrumbs, stops, stores } = await res.json() as {
      employees: LiveEmployee[]
      breadcrumbs: Breadcrumb[]
      stops: GpsStop[]
      stores: StoreLocation[]
    }

    heatCrumbsRef.current = breadcrumbs

    const empWithCoords = employees
      .map(emp => ({ ...emp, lat: Number(emp.lat), lng: Number(emp.lng) }))
      .filter(emp => isFinite(emp.lat) && isFinite(emp.lng) && emp.lat !== 0 && emp.lng !== 0)

    import('mapbox-gl').then(async mapboxgl => {
      const map = mapRef.current
      clearMarkers()
      clearPaths()

      const role = session?.role ?? ''
      let pathFeatures: object[] = []

      if (canSeePaths(role) && breadcrumbs.length > 0) {
        const dmEmps = empWithCoords.filter(e => e.user_role === 'manager')
        const matched = await Promise.all(dmEmps.map(async emp => {
          const crumbs = breadcrumbs.filter(b => b.shift_id === emp.shift_id)
          const allPts = [
            ...crumbs.map(c => ({ lng: Number(c.lng), lat: Number(c.lat) })),
            { lng: emp.lng, lat: emp.lat },
          ].filter(p => isFinite(p.lat) && isFinite(p.lng) && p.lat !== 0 && p.lng !== 0)

          const coords: [number, number][] = allPts.map(p => [p.lng, p.lat])
          const snapped = coords.length >= 2 ? await snapToRoads(coords) : coords
          return { emp, snapped }
        }))

        pathFeatures = matched
          .filter(({ snapped }) => snapped.length >= 2)
          .map(({ emp, snapped }) => ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: snapped },
            properties: { name: emp.full_name },
          }))
      }

      map.addSource(PATH_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: pathFeatures },
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
        const clockIn = new Date(emp.clock_in_at).toLocaleTimeString('en-US', {
          timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit',
        })
        const lastSeen = new Date(emp.last_seen_at).toLocaleTimeString('en-US', {
          timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit',
        })

        const el = makeMarkerEl(emp.full_name.split(' ')[0], '#22c55e')
        const marker = new mapboxgl.default.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([emp.lng, emp.lat])
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
        bounds.extend([emp.lng, emp.lat])
        hasPoints = true
      }

      // Store pins (for roles that can see paths)
      if (canSeePaths(role) && stores.length > 0) {
        for (const store of stores) {
          const shortAddr = store.address.split(',')[0]
          const el = makeStoreMarkerEl(shortAddr)
          const marker = new mapboxgl.default.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([store.lng, store.lat])
            .setPopup(new mapboxgl.default.Popup({ offset: 10 }).setHTML(`
              <div style="font-size:13px;line-height:1.6">
                <div style="color:#38bdf8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">● Store</div>
                <div style="color:#f9fafb;font-weight:600">${store.address}</div>
              </div>
            `))
            .addTo(map)
          markersRef.current.push(marker)
        }
      }

      // Purple stop markers
      if (canSeePaths(role) && stops.length > 0) {
        for (const stop of stops) {
          const emp = empWithCoords.find(e => e.shift_id === stop.shift_id)
          if (!emp) continue
          const el = makeStopMarkerEl()
          const marker = new mapboxgl.default.Marker({ element: el, anchor: 'center' })
            .setLngLat([Number(stop.lng), Number(stop.lat)])
            .setPopup(new mapboxgl.default.Popup({ offset: 10 }).setHTML(stopPopupHtml(emp.full_name, stop)))
            .addTo(map)
          markersRef.current.push(marker)
        }
      }

      if (hasPoints && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 80, maxZoom: 15 })
      }

      setLiveCount(empWithCoords.length)
      setLastUpdated(new Date())
    })
  }, [mapReady, session])

  // ── Historical map ─────────────────────────────────────────────────
  async function loadMap() {
    if (!mapRef.current || !mapReady || !session) return
    stopReplay()

    const params = new URLSearchParams()
    if (selectedUser) params.set('userId', selectedUser)
    if (from) params.set('from', from)
    if (to) params.set('to', to + 'T23:59:59')

    const res = await fetch(`/api/map?${params}`)
    if (!res.ok) return
    const { shifts, breadcrumbs, stops, stores }: {
      shifts: Shift[]
      breadcrumbs: Breadcrumb[]
      stops: GpsStop[]
      stores: StoreLocation[]
    } = await res.json()

    // Store breadcrumbs for heat map and replay
    heatCrumbsRef.current = breadcrumbs
    const dmCrumbs = breadcrumbs.filter(b => {
      const shift = shifts.find(s => s.id === b.shift_id)
      return shift?.user_role === 'manager'
    })
    setReplayBreadcrumbs(dmCrumbs)
    replayBreadcrumbsRef.current = dmCrumbs

    import('mapbox-gl').then(async mapboxgl => {
      const map = mapRef.current
      clearMarkers()
      clearPaths()
      if (heatMapMode) clearHeat()

      const bounds = new mapboxgl.default.LngLatBounds()
      let hasPoints = false

      let pathFeatures: object[] = []
      if (canSeePaths(session.role) && breadcrumbs.length > 0) {
        const dmShifts = shifts.filter(s => s.user_role === 'manager')
        const matched = await Promise.all(dmShifts.map(async shift => {
          const coords: [number, number][] = []
          if (shift.clock_in_lat && shift.clock_in_lng)
            coords.push([shift.clock_in_lng, shift.clock_in_lat])
          const crumbs = breadcrumbs.filter(b => b.shift_id === shift.id && !b.is_gap)
          for (const c of crumbs) coords.push([Number(c.lng), Number(c.lat)])
          if (shift.clock_out_lat && shift.clock_out_lng)
            coords.push([shift.clock_out_lng, shift.clock_out_lat])

          const snapped = coords.length >= 2 ? await snapToRoads(coords) : coords
          return { shift, snapped }
        }))

        pathFeatures = matched
          .filter(({ snapped }) => snapped.length >= 2)
          .map(({ shift, snapped }) => ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: snapped },
            properties: { name: shift.full_name },
          }))
      }

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
        if (shift.clock_in_lat && shift.clock_in_lng) {
          const el = makeMarkerEl(shift.full_name, '#22c55e')
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

        if (shift.clock_out_at && shift.clock_out_lat && shift.clock_out_lng) {
          const el = makeMarkerEl(shift.full_name, '#ef4444')
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

      // Store pins
      if (canSeePaths(session.role) && stores.length > 0) {
        for (const store of stores) {
          const shortAddr = store.address.split(',')[0]
          const el = makeStoreMarkerEl(shortAddr)
          const marker = new mapboxgl.default.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([store.lng, store.lat])
            .setPopup(new mapboxgl.default.Popup({ offset: 10 }).setHTML(`
              <div style="font-size:13px;line-height:1.6">
                <div style="color:#38bdf8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">● Store</div>
                <div style="color:#f9fafb;font-weight:600">${store.address}</div>
              </div>
            `))
            .addTo(map)
          markersRef.current.push(marker)
          bounds.extend([store.lng, store.lat])
          hasPoints = true
        }
      }

      // Purple stop markers
      if (canSeePaths(session.role) && stops.length > 0) {
        for (const stop of stops) {
          const shift = shifts.find(s => s.id === stop.shift_id)
          if (!shift) continue
          const el = makeStopMarkerEl()
          const marker = new mapboxgl.default.Marker({ element: el, anchor: 'center' })
            .setLngLat([Number(stop.lng), Number(stop.lat)])
            .setPopup(new mapboxgl.default.Popup({ offset: 10 }).setHTML(stopPopupHtml(shift.full_name, stop)))
            .addTo(map)
          markersRef.current.push(marker)
          bounds.extend([Number(stop.lng), Number(stop.lat)])
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
        clearPaths()
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
    if (mapReady && session && !liveMode) loadMap()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, session])

  useEffect(() => {
    if (mapReady && session && loaded) loadMap()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUser])

  const updatedAgo = lastUpdated
    ? (() => {
        const secs = Math.floor((Date.now() - lastUpdated.getTime()) / 1000)
        if (secs < 60) return `${secs}s ago`
        return `${Math.floor(secs / 60)}m ago`
      })()
    : null

  const replayCurrentTime = replayBreadcrumbs.filter(b => !b.is_gap)[replayIdx]?.recorded_at
  const replayTotal = replayBreadcrumbs.filter(b => !b.is_gap).length

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col pb-16 pt-14">
      {session && <NavBar role={session.role} fullName={session.fullName} />}

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

            {/* Heat map toggle */}
            {session && canSeePaths(session.role) && loaded && (
              <button
                onClick={toggleHeatMap}
                className={`text-sm font-semibold px-4 py-2 rounded-xl transition-colors ${
                  heatMapMode
                    ? 'bg-orange-600 hover:bg-orange-500 text-white'
                    : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
                }`}
              >
                Heat Map
              </button>
            )}

            {/* Route replay controls */}
            {session && canSeePaths(session.role) && replayTotal > 1 && (
              <div className="flex items-center gap-2">
                {!isReplaying ? (
                  <button
                    onClick={startReplay}
                    className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors flex items-center gap-1.5"
                  >
                    ▶ Replay Route
                  </button>
                ) : (
                  <>
                    <button
                      onClick={stopReplay}
                      className="bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold px-3 py-2 rounded-xl transition-colors"
                    >
                      ■ Stop
                    </button>
                    <div className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2">
                      <span className="text-xs text-amber-400 font-mono">
                        {replayCurrentTime
                          ? new Date(replayCurrentTime).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
                          : '--'}
                      </span>
                      <span className="text-gray-600 text-xs">·</span>
                      <span className="text-xs text-gray-400">{Math.round((replayIdx / Math.max(replayTotal - 1, 1)) * 100)}%</span>
                    </div>
                    <select
                      value={replaySpeed}
                      onChange={e => setReplaySpeed(Number(e.target.value))}
                      className="bg-gray-800 border border-gray-700 rounded-xl px-2 py-2 text-white text-xs"
                    >
                      <option value={10}>10×</option>
                      <option value={30}>30×</option>
                      <option value={60}>60×</option>
                      <option value={120}>120×</option>
                    </select>
                  </>
                )}
              </div>
            )}
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
      <div className="px-4 py-2 bg-gray-900 border-b border-gray-800 flex items-center gap-4 flex-wrap">
        {liveMode ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-green-500 block" style={{ boxShadow: '0 0 6px rgba(34,197,94,0.8)' }} />
              <span className="text-xs text-gray-400">Currently clocked in</span>
            </div>
            {session && canSeePaths(session.role) && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="w-8 block rounded" style={{ height: '3px', background: '#22c55e' }} />
                  <span className="text-xs text-gray-400">DM route</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full block" style={{ background: '#a855f7', boxShadow: '0 0 6px #a855f7aa' }} />
                  <span className="text-xs text-gray-400">30+ min stop</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full block" style={{ background: '#0ea5e9', boxShadow: '0 0 5px #0ea5e9aa' }} />
                  <span className="text-xs text-gray-400">Store</span>
                </div>
              </>
            )}
          </>
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
            {session && canSeePaths(session.role) && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="w-8 block rounded" style={{ height: '3px', background: '#818cf8' }} />
                  <span className="text-xs text-gray-400">DM route</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full block" style={{ background: '#a855f7', boxShadow: '0 0 6px #a855f7aa' }} />
                  <span className="text-xs text-gray-400">30+ min stop</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full block" style={{ background: '#0ea5e9', boxShadow: '0 0 5px #0ea5e9aa' }} />
                  <span className="text-xs text-gray-400">Store</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-4 h-2 rounded block" style={{ background: 'linear-gradient(to right, #6300ff, #ff64c8, #ffc800)' }} />
                  <span className="text-xs text-gray-400">Heat</span>
                </div>
                {replayTotal > 1 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full block" style={{ background: '#f59e0b', boxShadow: '0 0 6px #f59e0baa' }} />
                    <span className="text-xs text-gray-400">Replay marker</span>
                  </div>
                )}
              </>
            )}
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
