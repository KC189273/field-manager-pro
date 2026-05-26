export interface GpsStop {
  shift_id: string
  lat: number
  lng: number
  arrived_at: string
  departed_at: string | null
  store_name: string | null
}

export interface StoreLocation {
  id: string
  address: string
  lat: number
  lng: number
}

// 500 feet — how close a stop must be to a store to count as a visit
const STORE_VISIT_RADIUS_KM = 0.1524

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// 300 feet in km
const STOP_RADIUS_KM = 0.09144
const STOP_MIN_MINUTES = 30

export function computeStops(
  breadcrumbs: { shift_id: string; lat: number | string; lng: number | string; recorded_at: string }[]
): GpsStop[] {
  if (breadcrumbs.length === 0) return []

  const byShift = new Map<string, typeof breadcrumbs>()
  for (const b of breadcrumbs) {
    if (!byShift.has(b.shift_id)) byShift.set(b.shift_id, [])
    byShift.get(b.shift_id)!.push(b)
  }

  const stops: GpsStop[] = []

  for (const [shiftId, crumbs] of byShift) {
    if (crumbs.length < 2) continue
    crumbs.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())

    let anchorLat = Number(crumbs[0].lat)
    let anchorLng = Number(crumbs[0].lng)
    let clusterStart = crumbs[0].recorded_at
    let clusterEnd = crumbs[0].recorded_at
    let thresholdCrossed = false

    for (let i = 1; i < crumbs.length; i++) {
      const c = crumbs[i]
      const dist = distanceKm(anchorLat, anchorLng, Number(c.lat), Number(c.lng))

      if (dist <= STOP_RADIUS_KM) {
        clusterEnd = c.recorded_at
        const mins = (new Date(clusterEnd).getTime() - new Date(clusterStart).getTime()) / 60000
        if (mins >= STOP_MIN_MINUTES) thresholdCrossed = true
      } else {
        if (thresholdCrossed) {
          stops.push({
            shift_id: shiftId,
            lat: anchorLat,
            lng: anchorLng,
            arrived_at: clusterStart,
            departed_at: c.recorded_at,
            store_name: null,
          })
        }
        anchorLat = Number(c.lat)
        anchorLng = Number(c.lng)
        clusterStart = c.recorded_at
        clusterEnd = c.recorded_at
        thresholdCrossed = false
      }
    }

    // Final cluster still open (no departure yet)
    if (thresholdCrossed) {
      stops.push({
        shift_id: shiftId,
        lat: anchorLat,
        lng: anchorLng,
        arrived_at: clusterStart,
        departed_at: null,
        store_name: null,
      })
    }
  }

  return stops
}

export function matchStopsToStores(stops: GpsStop[], stores: StoreLocation[]): GpsStop[] {
  return stops.map(stop => {
    let closest: StoreLocation | null = null
    let closestDist = Infinity
    for (const store of stores) {
      const d = distanceKm(stop.lat, stop.lng, store.lat, store.lng)
      if (d < closestDist) { closestDist = d; closest = store }
    }
    return {
      ...stop,
      store_name: closest && closestDist <= STORE_VISIT_RADIUS_KM ? closest.address : null,
    }
  })
}
