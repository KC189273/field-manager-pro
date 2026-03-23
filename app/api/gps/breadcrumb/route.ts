import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

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

  await query(
    `INSERT INTO gps_breadcrumbs (shift_id, user_id, lat, lng, recorded_at, is_gap)
     VALUES ($1, $2, $3, $4, NOW(), $5)`,
    [shift.id, session.id, lat, lng, isGap ?? false]
  )

  return NextResponse.json({ ok: true })
}
