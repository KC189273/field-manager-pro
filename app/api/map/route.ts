import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (userId && userId !== session.id && !isManager(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const targetId = userId ?? session.id
  const params: unknown[] = [targetId]
  let dateFilter = ''
  if (from) { params.push(from); dateFilter += ` AND s.clock_in_at >= $${params.length}` }
  if (to) { params.push(to); dateFilter += ` AND s.clock_in_at <= $${params.length}` }

  const shifts = await query(`
    SELECT s.id, s.clock_in_at, s.clock_in_lat, s.clock_in_lng, s.clock_in_address,
           s.clock_out_at, s.clock_out_lat, s.clock_out_lng, s.clock_out_address,
           u.full_name, u.username
    FROM shifts s JOIN users u ON u.id = s.user_id
    WHERE s.user_id = $1 ${dateFilter}
    ORDER BY s.clock_in_at DESC LIMIT 30
  `, params)

  const breadcrumbs = shifts.length > 0
    ? await query(`
        SELECT b.shift_id, b.lat, b.lng, b.recorded_at, b.is_gap
        FROM gps_breadcrumbs b
        WHERE b.shift_id = ANY($1) ORDER BY b.recorded_at ASC
      `, [shifts.map(s => (s as { id: string }).id)])
    : []

  return NextResponse.json({ shifts, breadcrumbs })
}
