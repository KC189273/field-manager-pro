'use client'

import { useState, useEffect, useCallback } from 'react'
import NavBar from '@/components/NavBar'

type Role = 'employee' | 'manager' | 'ops_field_leader' | 'ops_manager' | 'owner' | 'sales_director' | 'developer'

interface Session {
  id: string
  fullName: string
  role: Role
  org_id?: string | null
}

interface StoreHours {
  day_of_week: number
  open_time: string | null
  close_time: string | null
  is_closed: boolean
}

interface Store {
  id: string
  address: string
  active: boolean
  org_id: string | null
  org_name: string | null
  employee_capacity: number
  lat: number | null
  lng: number | null
  geofence_radius_ft: number | null
  hours: StoreHours[]
  closed_today: boolean
  created_at: string
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatTime(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function hoursLabel(hours: StoreHours[]): string {
  if (!hours.length) return 'No hours set'
  const open = hours.filter(h => !h.is_closed)
  if (!open.length) return 'Closed all days'
  // Check if all open days have same times
  const times = new Set(open.map(h => `${h.open_time}-${h.close_time}`))
  if (times.size === 1) {
    const h = open[0]
    const days = open.map(d => DAY_NAMES[d.day_of_week]).join(', ')
    return `${days}: ${formatTime(h.open_time)}-${formatTime(h.close_time)}`
  }
  return `${open.length} days open`
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!MAPBOX_TOKEN) return null
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${MAPBOX_TOKEN}&limit=1&country=us`
    )
    const data = await res.json()
    const coords = data?.features?.[0]?.center
    if (coords && coords.length === 2) {
      return { lat: coords[1], lng: coords[0] }
    }
  } catch { /* non-fatal */ }
  return null
}

export default function StoreLocationsPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Add modal
  const [addOpen, setAddOpen] = useState(false)
  const [addAddress, setAddAddress] = useState('')
  const [addCapacity, setAddCapacity] = useState(1)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  // Edit modal
  const [editStore, setEditStore] = useState<Store | null>(null)
  const [editAddress, setEditAddress] = useState('')
  const [editCapacity, setEditCapacity] = useState(1)
  const [editLat, setEditLat] = useState('')
  const [editLng, setEditLng] = useState('')
  const [editGeofenceRadius, setEditGeofenceRadius] = useState('')
  const [editHours, setEditHours] = useState<Array<{ day_of_week: number; open_time: string; close_time: string; is_closed: boolean }>>([])
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [geocoding, setGeocoding] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setSession)
  }, [])

  const loadStores = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/dm-store-locations', { cache: 'no-store' })
      if (res.ok) {
        const d = await res.json()
        setStores(d.locations ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) loadStores()
  }, [session, loadStores])

  const canManage = session && (session.role === 'owner' || session.role === 'sales_director' || session.role === 'developer')

  async function handleAdd() {
    if (!addAddress.trim()) { setAddError('Address is required.'); return }
    setAdding(true)
    setAddError('')
    try {
      const coords = await geocodeAddress(addAddress.trim())
      const res = await fetch('/api/dm-store-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: addAddress.trim(),
          org_id: session?.org_id ?? null,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setAddError(d.error ?? 'Failed to add store.'); return
      }
      // Set capacity if not default
      if (addCapacity > 1) {
        const d = await res.json().catch(() => null)
        if (d?.location?.id) {
          await fetch('/api/dm-store-locations', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: d.location.id, employee_capacity: addCapacity }),
          }).catch(() => {})
        }
      }
      setAddOpen(false)
      setAddAddress('')
      setAddCapacity(1)
      await loadStores()
    } catch {
      setAddError('Network error. Please try again.')
    } finally {
      setAdding(false)
    }
  }

  function openEdit(store: Store) {
    setEditStore(store)
    setEditAddress(store.address)
    setEditCapacity(store.employee_capacity)
    setEditLat(store.lat?.toString() ?? '')
    setEditLng(store.lng?.toString() ?? '')
    setEditGeofenceRadius(store.geofence_radius_ft?.toString() ?? '')
    setEditError('')
    // Load hours — fill all 7 days, defaulting missing ones
    const hrs = []
    for (let d = 0; d < 7; d++) {
      const existing = store.hours?.find(h => h.day_of_week === d)
      if (existing) {
        hrs.push({ day_of_week: d, open_time: existing.open_time ?? '10:00', close_time: existing.close_time ?? '19:00', is_closed: existing.is_closed })
      } else {
        hrs.push({ day_of_week: d, open_time: d === 0 ? '12:00' : '10:00', close_time: d === 0 ? '17:00' : '19:00', is_closed: false })
      }
    }
    setEditHours(hrs)
  }

  async function handleGeocode() {
    if (!editAddress.trim()) return
    setGeocoding(true)
    const coords = await geocodeAddress(editAddress.trim())
    if (coords) {
      setEditLat(coords.lat.toFixed(6))
      setEditLng(coords.lng.toFixed(6))
    } else {
      setEditError('Could not geocode this address. You can enter coordinates manually.')
    }
    setGeocoding(false)
  }

  async function handleSave() {
    if (!editStore || !editAddress.trim()) { setEditError('Address is required.'); return }
    setSaving(true)
    setEditError('')
    try {
      const res = await fetch('/api/dm-store-locations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editStore.id,
          address: editAddress.trim(),
          employee_capacity: editCapacity,
          lat: editLat ? parseFloat(editLat) : null,
          lng: editLng ? parseFloat(editLng) : null,
          geofence_radius_ft: editGeofenceRadius ? parseInt(editGeofenceRadius) : null,
          hours: editHours,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setEditError(d.error ?? 'Save failed.'); return
      }
      setEditStore(null)
      await loadStores()
    } catch {
      setEditError('Network error.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(store: Store) {
    const action = store.active ? 'deactivate' : 'reactivate'
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} "${store.address}"?`)) return
    await fetch('/api/dm-store-locations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: store.id, active: !store.active }),
    })
    await loadStores()
  }

  async function bulkGeocode() {
    const missing = stores.filter(s => s.active && !s.lat && !s.lng)
    if (!missing.length) { alert('All active stores already have coordinates.'); return }
    if (!confirm(`Geocode ${missing.length} stores without coordinates? This may take a moment.`)) return

    let updated = 0
    for (const store of missing) {
      const coords = await geocodeAddress(store.address)
      if (coords) {
        await fetch('/api/dm-store-locations', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: store.id, lat: coords.lat, lng: coords.lng }),
        })
        updated++
      }
    }
    alert(`Geocoded ${updated} of ${missing.length} stores.`)
    await loadStores()
  }

  if (!session) return <div className="min-h-screen bg-gray-950" />
  if (!canManage) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <NavBar role={session.role} fullName={session.fullName} />
      <p className="text-gray-500">Access denied.</p>
    </div>
  )

  const filtered = stores.filter(s =>
    !search || s.address.toLowerCase().includes(search.toLowerCase())
  )
  const activeStores = filtered.filter(s => s.active)
  const inactiveStores = filtered.filter(s => !s.active)
  const missingCoords = stores.filter(s => s.active && !s.lat && !s.lng).length

  return (
    <div className="min-h-screen bg-gray-950 pb-24 pt-14">
      <NavBar role={session.role} fullName={session.fullName} />

      <div className="px-4 pt-4 pb-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-white">Store Locations</h1>
            <p className="text-xs text-gray-500 mt-0.5">{stores.filter(s => s.active).length} active stores</p>
          </div>
          <button onClick={() => { setAddOpen(true); setAddError('') }}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors shrink-0">
            <span className="text-base leading-none">+</span>
            <span>Add Store</span>
          </button>
        </div>

        {/* Search + Bulk Geocode */}
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search stores..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 rounded-2xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-600" />
          </div>
          {missingCoords > 0 && (
            <button onClick={bulkGeocode}
              className="flex items-center gap-1.5 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-600/40 text-amber-400 text-xs font-semibold px-3 py-2 rounded-xl transition-colors shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Geocode {missingCoords}
            </button>
          )}
        </div>

        {/* Store list */}
        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 animate-pulse">
                <div className="h-4 bg-gray-800 rounded w-48 mb-2" />
                <div className="h-3 bg-gray-800 rounded w-32" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {activeStores.length === 0 && inactiveStores.length === 0 && (
              <div className="bg-gray-900/50 border border-dashed border-gray-800 rounded-2xl px-4 py-12 text-center">
                <p className="text-sm text-gray-600">
                  {search ? 'No stores match your search.' : 'No store locations yet. Add your first store.'}
                </p>
              </div>
            )}

            {activeStores.length > 0 && (
              <div className="space-y-2 mb-6">
                {activeStores.map(store => (
                  <div key={store.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 transition-all">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white">{store.address}</p>
                        <p className="text-xs text-gray-500 mt-1">{hoursLabel(store.hours ?? [])}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                          <span className="text-xs text-gray-500">Capacity: {store.employee_capacity}</span>
                          {store.lat && store.lng ? (
                            <span className="text-xs text-green-500 flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              GPS set
                            </span>
                          ) : (
                            <span className="text-xs text-amber-500 flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              No GPS
                            </span>
                          )}
                          {store.geofence_radius_ft && (
                            <span className="text-xs text-cyan-500">{store.geofence_radius_ft}ft geofence</span>
                          )}
                          {store.closed_today && (
                            <span className="text-xs text-red-400 font-semibold">Closed Today</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={async () => {
                            const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
                            await fetch('/api/dm-store-locations', {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(store.closed_today
                                ? { id: store.id, closureDate: true, reopenDate: today }
                                : { id: store.id, closureDate: today, closureReason: 'Temporarily closed' }),
                            })
                            loadStores()
                          }}
                          className={`text-xs font-semibold transition-colors p-1 ${store.closed_today ? 'text-green-400 hover:text-green-300' : 'text-red-400 hover:text-red-300'}`}
                          title={store.closed_today ? 'Reopen store' : 'Close store for today'}
                        >
                          {store.closed_today ? 'Reopen' : 'Close Today'}
                        </button>
                        <button onClick={() => openEdit(store)} className="text-gray-500 hover:text-gray-300 transition-colors p-1">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button onClick={() => toggleActive(store)} className="text-gray-500 hover:text-red-400 transition-colors p-1" title="Deactivate">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {inactiveStores.length > 0 && (
              <div>
                <h2 className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Inactive ({inactiveStores.length})</h2>
                <div className="space-y-2">
                  {inactiveStores.map(store => (
                    <div key={store.id} className="bg-gray-900/50 border border-gray-800/50 rounded-2xl p-4 opacity-60">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-gray-400 line-through">{store.address}</p>
                        <button onClick={() => toggleActive(store)} className="text-xs text-violet-400 hover:text-violet-300 font-semibold transition-colors shrink-0">
                          Reactivate
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Add Store Modal ── */}
      {addOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={() => setAddOpen(false)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg border border-gray-800 p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-white">Add Store Location</h2>
              <button onClick={() => setAddOpen(false)} className="text-gray-500 hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Store Address <span className="text-red-400">*</span></label>
                <input type="text" value={addAddress} onChange={e => setAddAddress(e.target.value)} placeholder="e.g. 123 Main St Milwaukee WI"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" autoFocus />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Employee Capacity</label>
                <input type="number" min={1} max={50} value={addCapacity} onChange={e => setAddCapacity(parseInt(e.target.value) || 1)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500" />
                <p className="text-xs text-gray-600 mt-1">How many employees can work at this location.</p>
              </div>
              <p className="text-xs text-gray-500">GPS coordinates will be auto-detected from the address.</p>

              {addError && (
                <div className="rounded-xl bg-red-900/30 border border-red-600/40 px-4 py-3 text-sm text-red-400">{addError}</div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => setAddOpen(false)} className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
                <button onClick={handleAdd} disabled={adding || !addAddress.trim()}
                  className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors">
                  {adding ? 'Adding...' : 'Add Store'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Store Modal ── */}
      {editStore && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={() => setEditStore(null)}>
          <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg border border-gray-800 p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-white">Edit Store</h2>
              <button onClick={() => setEditStore(null)} className="text-gray-500 hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Store Address <span className="text-red-400">*</span></label>
                <input type="text" value={editAddress} onChange={e => setEditAddress(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Employee Capacity</label>
                <input type="number" min={1} max={50} value={editCapacity} onChange={e => setEditCapacity(parseInt(e.target.value) || 1)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-gray-400">GPS Coordinates</label>
                  <button onClick={handleGeocode} disabled={geocoding || !editAddress.trim()}
                    className="text-xs text-violet-400 hover:text-violet-300 font-semibold disabled:opacity-50 transition-colors">
                    {geocoding ? 'Looking up...' : 'Auto-detect from address'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-600 mb-1">Latitude</label>
                    <input type="text" value={editLat} onChange={e => setEditLat(e.target.value)} placeholder="e.g. 43.0389"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-600 mb-1">Longitude</label>
                    <input type="text" value={editLng} onChange={e => setEditLng(e.target.value)} placeholder="e.g. -87.9065"
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                  </div>
                </div>
                <p className="text-xs text-gray-600 mt-1.5">Required for geofencing. Click &quot;Auto-detect&quot; or enter manually.</p>
              </div>

              {/* Geofence Radius */}
              <div>
                <label className="block text-[10px] text-gray-600 mb-1">Geofence Radius (feet)</label>
                <div className="flex items-center gap-3">
                  <input type="number" value={editGeofenceRadius} onChange={e => setEditGeofenceRadius(e.target.value)}
                    placeholder="Org default"
                    min={50} max={5000} step={50}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                  {editGeofenceRadius && (
                    <button type="button" onClick={() => setEditGeofenceRadius('')}
                      className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Reset to default</button>
                  )}
                </div>
                <p className="text-xs text-gray-600 mt-1">{editGeofenceRadius ? `${editGeofenceRadius}ft radius for this store` : 'Uses org default (Settings → Geofence)'}</p>
              </div>

              {/* Store Hours */}
              <div>
                <label className="text-xs text-gray-400 block mb-2">Store Hours</label>
                <div className="space-y-2">
                  {editHours.map((h, i) => (
                    <div key={h.day_of_week} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-8 shrink-0 font-semibold">{DAY_NAMES[h.day_of_week]}</span>
                      <label className="flex items-center gap-1.5 shrink-0">
                        <input type="checkbox" checked={!h.is_closed}
                          onChange={e => {
                            const next = [...editHours]
                            next[i] = { ...next[i], is_closed: !e.target.checked }
                            setEditHours(next)
                          }}
                          className="accent-violet-500 w-3.5 h-3.5" />
                        <span className="text-[10px] text-gray-500">Open</span>
                      </label>
                      {!h.is_closed ? (
                        <div className="flex items-center gap-1.5 flex-1">
                          <input type="time" value={h.open_time}
                            onChange={e => {
                              const next = [...editHours]
                              next[i] = { ...next[i], open_time: e.target.value }
                              setEditHours(next)
                            }}
                            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500 flex-1" />
                          <span className="text-gray-600 text-xs">to</span>
                          <input type="time" value={h.close_time}
                            onChange={e => {
                              const next = [...editHours]
                              next[i] = { ...next[i], close_time: e.target.value }
                              setEditHours(next)
                            }}
                            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500 flex-1" />
                        </div>
                      ) : (
                        <span className="text-xs text-gray-600 italic">Closed</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {editError && (
                <div className="rounded-xl bg-red-900/30 border border-red-600/40 px-4 py-3 text-sm text-red-400">{editError}</div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => toggleActive(editStore)}
                  className="px-4 py-3 rounded-xl bg-red-600/20 hover:bg-red-600/40 text-red-400 font-medium text-sm border border-red-600/30 transition-colors">
                  {editStore.active ? 'Deactivate' : 'Reactivate'}
                </button>
                <button onClick={() => setEditStore(null)} className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
                <button onClick={handleSave} disabled={saving || !editAddress.trim()}
                  className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors">
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
