import { NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'
import { computeStops, matchStopsToStores, type StoreLocation } from '@/lib/gps'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const canViewAll = isOwner(session.role) || session.role === 'ops_manager' || session.role === 'developer'
  const isDM = session.role === 'manager'

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = []
  let userFilter = ''

  if (canViewAll) {
    // Owners / ops_manager / developer see all users in org
    userFilter += appendOrgFilter(orgFilter, params, 'u')
  } else if (isDM) {
    // DM sees themselves + their direct employees only
    params.push(session.id)
    userFilter = ` AND (s.user_id = $${params.length} OR (u.manager_id = $${params.length} AND u.role = 'employee'))`
  } else {
    // Employees only see themselves
    params.push(session.id)
    userFilter = ` AND s.user_id = $${params.length}`
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

  const rawStops = computeStops(breadcrumbs)

  // Fetch store locations for all visible DM shifts so we can match stops to stores
  const dmUserIds = employees.filter(e => e.user_role === 'manager').map(e => e.user_id)
  let stores: StoreLocation[] = []
  if (dmUserIds.length > 0) {
    stores = await query<StoreLocation>(`
      SELECT DISTINCT dsl.id, dsl.address, dsl.lat::float, dsl.lng::float
      FROM dm_store_locations dsl
      JOIN dm_manager_stores dms ON dms.store_location_id = dsl.id
      WHERE dms.manager_id = ANY($1)
        AND dsl.lat IS NOT NULL AND dsl.lng IS NOT NULL
    `, [dmUserIds])
  }

  const stops = matchStopsToStores(rawStops, stores)

  return NextResponse.json({ employees, breadcrumbs, stops, stores })
}
