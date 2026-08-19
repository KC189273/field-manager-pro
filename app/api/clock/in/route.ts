import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getGeofenceSettings, haversineDistanceFt } from '@/lib/geofence'

let ensured = false
async function ensureShiftColumns() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS store_location_id UUID`)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lat, lng, address, storeId, photoKey } = await req.json()

  try { await ensureShiftColumns() } catch {}
  await query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS clock_in_photo_key TEXT`).catch(() => {})

  // Check if already clocked in
  const active = await queryOne(
    `SELECT id FROM shifts WHERE user_id = $1 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL`,
    [session.id]
  )
  if (active) return NextResponse.json({ error: 'Already clocked in' }, { status: 409 })

  // ── Geofence check (employees only) ──
  if (session.role === 'employee') {
    const geo = await getGeofenceSettings(session.org_id)
    if (geo.enabled) {
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
        if (distFt > geo.radius_ft) {
          return NextResponse.json({
            error: `You are too far from ${store.address} to clock in. You must be within ${geo.radius_ft} feet of the store. (Currently ${Math.round(distFt)} ft away)`,
            distanceFt: Math.round(distFt),
          }, { status: 403 })
        }
      }
    }
  }

  const shift = await queryOne<{ id: string }>(
    `INSERT INTO shifts (user_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_address, store_location_id, clock_in_photo_key)
     VALUES ($1, NOW(), $2, $3, $4, $5, $6) RETURNING id`,
    [session.id, lat, lng, address ?? null, storeId || null, photoKey || null]
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

  // Flag missing clock-in photo (check org setting)
  if (!photoKey) {
    try {
      const photoRequired = await queryOne<{ val: boolean }>(`
        SELECT COALESCE((SELECT geofence_enabled FROM organizations WHERE id = $1), FALSE) as val
      `, [session.org_id]).catch(() => null)
      // For now, use a dev_config flag for mandatory photos
      const mandatory = await queryOne<{ value: string }>(`
        SELECT value FROM dev_config WHERE key = 'clock_in_photo_required'
      `).catch(() => null)
      if (mandatory?.value === 'true') {
        const todayCST = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
        await query(
          `INSERT INTO flags (user_id, shift_id, type, date, detail, store_location_id)
           VALUES ($1, $2, 'missing_clock_in_photo', $3, $4, $5)`,
          [session.id, shift!.id, todayCST,
           `${session.fullName} clocked in without a uniform photo.`,
           storeId || null]
        )
        // Notify DM
        const mgr = await queryOne<{ id: string }>(`SELECT manager_id as id FROM users WHERE id = $1 AND manager_id IS NOT NULL`, [session.id])
        if (mgr) {
          const { sendPushToUser } = await import('@/lib/apns')
          sendPushToUser(mgr.id, 'Missing Clock-In Photo', `${session.fullName} clocked in without a uniform photo.`, 'flag_created').catch(() => {})
        }
      }
    } catch { /* never block clock-in */ }
  }

  return NextResponse.json({ ok: true, shiftId: shift!.id })
}
