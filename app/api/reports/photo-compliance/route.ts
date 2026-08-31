import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query } from '@/lib/db'

const CST = 'America/Chicago'
const ALLOWED = ['ops_manager', 'owner', 'sales_director', 'developer']

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') || new Date().toLocaleDateString('en-CA', { timeZone: CST })

  // Get org filter
  let orgFilter = ''
  const params: unknown[] = [date]
  if (session.org_id) {
    params.push(session.org_id)
    orgFilter = `AND u.org_id = $${params.length}`
  }

  const shifts = await query<{
    user_id: string
    full_name: string
    username: string
    manager_name: string | null
    store_address: string | null
    clock_in_at: string
    has_photo: boolean
  }>(`
    SELECT s.user_id, u.full_name, u.username,
           m.full_name as manager_name,
           sl.address as store_address,
           s.clock_in_at::text,
           (s.clock_in_photo_key IS NOT NULL AND s.clock_in_photo_key != '') as has_photo
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN users m ON m.id = u.manager_id
    LEFT JOIN dm_store_locations sl ON sl.id = s.store_location_id
    WHERE (s.clock_in_at AT TIME ZONE 'America/Chicago')::date = $1::date
      AND u.role = 'employee'
      ${orgFilter}
    ORDER BY u.full_name, s.clock_in_at
  `, params)

  const withPhoto = shifts.filter(s => s.has_photo)
  const withoutPhoto = shifts.filter(s => !s.has_photo)
  const totalShifts = shifts.length
  const photoRate = totalShifts > 0 ? Math.round((withPhoto.length / totalShifts) * 100) : 0

  // Group by DM
  const byDm: Record<string, { total: number; withPhoto: number; employees: typeof shifts }> = {}
  for (const s of shifts) {
    const dm = s.manager_name || 'Unassigned'
    if (!byDm[dm]) byDm[dm] = { total: 0, withPhoto: 0, employees: [] }
    byDm[dm].total++
    if (s.has_photo) byDm[dm].withPhoto++
    byDm[dm].employees.push(s)
  }

  return NextResponse.json({
    date,
    totalShifts,
    withPhoto: withPhoto.length,
    withoutPhoto: withoutPhoto.length,
    photoRate,
    byDm,
    missing: withoutPhoto,
  })
}
