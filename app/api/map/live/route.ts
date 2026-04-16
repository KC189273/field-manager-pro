import { NextResponse } from 'next/server'
import { getSession, isManager, isOwner } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const canViewAll = isManager(session.role) || isOwner(session.role) || session.role === 'developer'

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = []
  let userFilter = ''

  if (!canViewAll) {
    // Employees only see themselves
    params.push(session.id)
    userFilter = ` AND s.user_id = $${params.length}`
  } else {
    userFilter += appendOrgFilter(orgFilter, params, 'u')
  }

  const employees = await query<{
    shift_id: string
    user_id: string
    full_name: string
    user_role: string
    clock_in_at: string
    lat: number | null
    lng: number | null
    last_seen_at: string
  }>(`
    SELECT
      s.id AS shift_id,
      s.user_id,
      u.full_name,
      u.role AS user_role,
      s.clock_in_at::text,
      COALESCE(
        (SELECT b.lat FROM gps_breadcrumbs b WHERE b.shift_id = s.id AND b.lat IS NOT NULL AND b.is_gap = false ORDER BY b.recorded_at DESC LIMIT 1),
        s.clock_in_lat
      ) AS lat,
      COALESCE(
        (SELECT b.lng FROM gps_breadcrumbs b WHERE b.shift_id = s.id AND b.lng IS NOT NULL AND b.is_gap = false ORDER BY b.recorded_at DESC LIMIT 1),
        s.clock_in_lng
      ) AS lng,
      COALESCE(
        (SELECT b.recorded_at::text FROM gps_breadcrumbs b WHERE b.shift_id = s.id AND b.lat IS NOT NULL AND b.is_gap = false ORDER BY b.recorded_at DESC LIMIT 1),
        s.clock_in_at::text
      ) AS last_seen_at
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    WHERE s.clock_out_at IS NULL
      AND u.role != 'developer'
      AND u.is_active = TRUE
      ${userFilter}
    ORDER BY u.full_name
  `, params)

  // Breadcrumbs only for DM (manager) shifts, and only for higher roles
  const canSeePaths = ['sales_director', 'ops_manager', 'owner', 'developer'].includes(session.role)
  const dmShiftIds = canSeePaths
    ? employees.filter(e => e.user_role === 'manager').map(e => e.shift_id)
    : []

  const breadcrumbs = dmShiftIds.length > 0
    ? await query<{ shift_id: string; lat: number; lng: number; recorded_at: string }>(
        `SELECT shift_id, lat, lng, recorded_at::text
         FROM gps_breadcrumbs
         WHERE shift_id = ANY($1) AND lat IS NOT NULL AND is_gap = false
         ORDER BY recorded_at ASC`,
        [dmShiftIds]
      )
    : []

  return NextResponse.json({ employees, breadcrumbs })
}
