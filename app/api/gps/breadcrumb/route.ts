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

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lat, lng, isGap } = await req.json()
  if (!lat || !lng) return NextResponse.json({ error: 'Missing coordinates' }, { status: 400 })

  const shift = await queryOne<{ id: string }>(
    `SELECT id FROM shifts WHERE user_id = $1 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL`,
    [session.id]
  )
  if (!shift) return NextResponse.json({ error: 'No active shift' }, { status: 404 })

  // Check last breadcrumb to detect GPS jumps
  let markAsGap = isGap ?? false
  if (!markAsGap) {
    const last = await queryOne<{ lat: number; lng: number; recorded_at: string }>(
      `SELECT lat, lng, recorded_at FROM gps_breadcrumbs
       WHERE shift_id = $1 AND is_gap = false AND lat IS NOT NULL AND lng IS NOT NULL
       ORDER BY recorded_at DESC LIMIT 1`,
      [shift.id]
    )
    if (last) {
      const dist = distanceKm(Number(last.lat), Number(last.lng), lat, lng)
      const minutes = (Date.now() - new Date(last.recorded_at).getTime()) / 60000
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

  return NextResponse.json({ ok: true })
}
