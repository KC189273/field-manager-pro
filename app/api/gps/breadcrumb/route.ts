import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

// Haversine distance in km between two GPS points
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Haversine distance in feet */
function distanceFt(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return distanceKm(lat1, lng1, lat2, lng2) * 3280.84
}

const GEOFENCE_RADIUS_FT = 300
const GEOFENCE_EXIT_MINUTES = 10

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lat, lng, isGap } = await req.json()
  if (!lat || !lng) return NextResponse.json({ error: 'Missing coordinates' }, { status: 400 })

  const shift = await queryOne<{ id: string; store_location_id: string | null; clock_in_at: string }>(
    `SELECT id, store_location_id, clock_in_at::text FROM shifts WHERE user_id = $1 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL`,
    [session.id]
  )
  if (!shift) return NextResponse.json({ error: 'No active shift' }, { status: 404 })

  // Check last breadcrumb for dedup and GPS jump detection
  let markAsGap = isGap ?? false
  const last = await queryOne<{ lat: number; lng: number; recorded_at: string }>(
    `SELECT lat, lng, recorded_at FROM gps_breadcrumbs
     WHERE shift_id = $1 AND is_gap = false AND lat IS NOT NULL
     ORDER BY recorded_at DESC LIMIT 1`,
    [shift.id]
  )
  if (last) {
    const dist = distanceKm(Number(last.lat), Number(last.lng), lat, lng)
    const minutes = (Date.now() - new Date(last.recorded_at).getTime()) / 60000

    // Dedup: skip if < 3 min since last AND < 30m movement (avoids DB flood with distanceFilter:0)
    if (minutes < 3 && dist < 0.03) {
      return NextResponse.json({ ok: true, skipped: true })
    }

    if (!markAsGap) {
      const speedKph = dist / (minutes / 60)
      // Mark as gap if speed would exceed 200 km/h (GPS jump) or distance > 100km
      if (speedKph > 200 || dist > 100) {
        markAsGap = true
      }
    }
  }

  await query(
    `INSERT INTO gps_breadcrumbs (shift_id, user_id, lat, lng, recorded_at, is_gap)
     VALUES ($1, $2, $3, $4, NOW(), $5)`,
    [shift.id, session.id, lat, lng, markAsGap]
  )

  // ── Geofence exit check (employees only) ──
  if (session.role === 'employee' && shift.store_location_id && !markAsGap) {
    try {
      const store = await queryOne<{ lat: number; lng: number; address: string }>(
        `SELECT lat, lng, address FROM dm_store_locations WHERE id = $1`,
        [shift.store_location_id]
      )
      if (store && store.lat && store.lng) {
        const dist = distanceFt(lat, lng, store.lat, store.lng)
        if (dist > GEOFENCE_RADIUS_FT) {
          // Check how long they've been outside the geofence
          // Look at recent breadcrumbs in reverse — find the last one inside the fence
          const recentCrumbs = await query<{ lat: number; lng: number; recorded_at: string }>(
            `SELECT lat, lng, recorded_at FROM gps_breadcrumbs
             WHERE shift_id = $1 AND is_gap = false AND lat IS NOT NULL
             ORDER BY recorded_at DESC LIMIT 10`,
            [shift.id]
          )

          // Find the earliest consecutive out-of-fence breadcrumb
          let firstOutsideAt: Date | null = null
          for (const crumb of recentCrumbs) {
            const crumbDist = distanceFt(Number(crumb.lat), Number(crumb.lng), store.lat, store.lng)
            if (crumbDist <= GEOFENCE_RADIUS_FT) break // Found one inside — stop
            firstOutsideAt = new Date(crumb.recorded_at)
          }

          if (firstOutsideAt) {
            const minutesOutside = (Date.now() - firstOutsideAt.getTime()) / 60000
            if (minutesOutside >= GEOFENCE_EXIT_MINUTES) {
              // Auto clock out
              await query(
                `UPDATE shift_breaks SET break_end = NOW() WHERE shift_id = $1 AND break_end IS NULL`,
                [shift.id]
              ).catch(() => {})

              await query(
                `UPDATE shifts SET clock_out_at = NOW(), clock_out_lat = $2, clock_out_lng = $3,
                 clock_out_address = 'Auto clock-out: left store geofence'
                 WHERE id = $1`,
                [shift.id, lat, lng]
              )

              // Create a flag
              const todayCST = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
              await query(
                `INSERT INTO flags (user_id, shift_id, type, date, detail, store_location_id)
                 VALUES ($1, $2, 'geofence_exit', $3, $4, $5)`,
                [session.id, shift.id, todayCST,
                 `${session.fullName} was auto clocked out — left ${store.address} geofence for ${Math.round(minutesOutside)} minutes (${Math.round(dist)} ft away)`,
                 shift.store_location_id]
              )

              // Notify employee + DM
              const { sendPushToUser } = await import('@/lib/apns')
              sendPushToUser(
                session.id,
                'Auto Clock-Out',
                `You were clocked out because you left ${store.address.split(',')[0]} for over ${GEOFENCE_EXIT_MINUTES} minutes.`,
                'geofence'
              ).catch(() => {})

              const manager = await queryOne<{ id: string }>(
                `SELECT manager_id as id FROM users WHERE id = $1 AND manager_id IS NOT NULL`,
                [session.id]
              )
              if (manager) {
                sendPushToUser(
                  manager.id,
                  'Geofence Auto Clock-Out',
                  `${session.fullName} was auto clocked out — left ${store.address.split(',')[0]} for ${Math.round(minutesOutside)} min.`,
                  'geofence'
                ).catch(() => {})
              }

              return NextResponse.json({ ok: true, autoClockOut: true })
            }
          }
        }
      }
    } catch (err) {
      console.error('Geofence check error:', err)
    }
  }

  return NextResponse.json({ ok: true })
}
