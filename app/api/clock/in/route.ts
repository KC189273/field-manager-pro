import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lat, lng, address } = await req.json()
  if (!lat || !lng) return NextResponse.json({ error: 'GPS coordinates required' }, { status: 400 })

  // Check if already clocked in
  const active = await queryOne(
    `SELECT id FROM shifts WHERE user_id = $1 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL`,
    [session.id]
  )
  if (active) return NextResponse.json({ error: 'Already clocked in' }, { status: 409 })

  const shift = await queryOne<{ id: string }>(
    `INSERT INTO shifts (user_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_address)
     VALUES ($1, NOW(), $2, $3, $4) RETURNING id`,
    [session.id, lat, lng, address ?? null]
  )

  // Record first breadcrumb
  await query(
    `INSERT INTO gps_breadcrumbs (shift_id, user_id, lat, lng, recorded_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [shift!.id, session.id, lat, lng]
  )

  return NextResponse.json({ ok: true, shiftId: shift!.id })
}
