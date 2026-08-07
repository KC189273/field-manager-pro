import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

/** Haversine distance in feet between two lat/lng points */
function haversineDistanceFt(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231 // Earth radius in feet
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const GEOFENCE_RADIUS_FT = 300

let ensured = false
async function ensureShiftColumns() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS store_location_id UUID`)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lat, lng, address, storeId } = await req.json()

  try { await ensureShiftColumns() } catch {}

  // Check if already clocked in
  const active = await queryOne(
    `SELECT id FROM shifts WHERE user_id = $1 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL`,
    [session.id]
  )
  if (active) return NextResponse.json({ error: 'Already clocked in' }, { status: 409 })

  // ── Geofence check (employees only) ──
  if (session.role === 'employee') {
    if (!lat || !lng) {
      return NextResponse.json({ error: 'Location is required to clock in. Please enable GPS and try again.' }, { status: 400 })
    }
    if (!storeId) {
      return NextResponse.json({ error: 'Please select which store you are working at.' }, { status: 400 })
    }
    const store = await queryOne<{ lat: number; lng: number; address: string }>(
      `SELECT lat, lng, address FROM dm_store_locations WHERE id = $1`,
      [storeId]
    )
    if (store && store.lat && store.lng) {
      const distFt = haversineDistanceFt(lat, lng, store.lat, store.lng)
      if (distFt > GEOFENCE_RADIUS_FT) {
        return NextResponse.json({
          error: `You are too far from ${store.address} to clock in. You must be within ${GEOFENCE_RADIUS_FT} feet of the store. (Currently ${Math.round(distFt)} ft away)`,
          distanceFt: Math.round(distFt),
        }, { status: 403 })
      }
    }
  }

  const shift = await queryOne<{ id: string }>(
    `INSERT INTO shifts (user_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_address, store_location_id)
     VALUES ($1, NOW(), $2, $3, $4, $5) RETURNING id`,
    [session.id, lat, lng, address ?? null, storeId || null]
  )

  // Record first breadcrumb if coordinates available
  if (lat && lng) {
    await query(
      `INSERT INTO gps_breadcrumbs (shift_id, user_id, lat, lng, recorded_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [shift!.id, session.id, lat, lng]
    )
  }

  // Check for late clock-in against scheduled shift
  try {
    const todayCST = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
    const nowHHMM = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour12: false, hour: '2-digit', minute: '2-digit' })

    const scheduled = await queryOne<{ start_time: string; store_location_id: string | null }>(
      `SELECT start_time::text, store_location_id FROM scheduled_shifts
       WHERE employee_id = $1 AND shift_date = $2
       ORDER BY start_time LIMIT 1`,
      [session.id, todayCST]
    )

    if (scheduled) {
      const schHHMM = scheduled.start_time.slice(0, 5)
      const [sh, sm] = schHHMM.split(':').map(Number)
      const [nh, nm] = nowHHMM.split(':').map(Number)
      const minsLate = (nh * 60 + nm) - (sh * 60 + sm)

      if (minsLate > 0) {
        const fmt = (hhmm: string) => {
          const [h, m] = hhmm.split(':').map(Number)
          return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
        }
        await query(
          `INSERT INTO flags (user_id, shift_id, type, date, detail, store_location_id)
           VALUES ($1, $2, 'late_clock_in', $3, $4, $5)`,
          [
            session.id, shift!.id, todayCST,
            `${session.fullName} clocked in at ${fmt(nowHHMM)}, scheduled for ${fmt(schHHMM)} (${minsLate} min late)`,
            scheduled.store_location_id ?? null,
          ]
        )
      }
    }
  } catch { /* never block clock-in */ }

  return NextResponse.json({ ok: true, shiftId: shift!.id })
}
