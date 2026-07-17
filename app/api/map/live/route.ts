import { NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'
import { computeStops, matchStopsToStores, type StoreLocation } from '@/lib/gps'
import { getReceiptViewUrl } from '@/lib/s3'

// Short-lived cache to prevent 16 identical queries when multiple users poll simultaneously
let liveCache: { data: unknown; orgId: string | null; expiresAt: number } | null = null
const CACHE_TTL_MS = 10_000 // 10 seconds

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const canViewAll = isOwner(session.role) || session.role === 'developer'
  const isDM = session.role === 'manager'

  // Restrict map access to SD, owner, developer only
  if (!canViewAll && !isDM) {
    return NextResponse.json({ employees: [], breadcrumbs: [], stops: [], stores: [] })
  }

  const orgFilter = await getOrgFilter(session)

  // Return cached result for org-wide viewers if fresh
  if (canViewAll && liveCache && liveCache.orgId === (orgFilter.orgId ?? null) && liveCache.expiresAt > Date.now()) {
    return NextResponse.json(liveCache.data)
  }

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

  const rawEmployees = await query<{
    shift_id: string
    user_id: string
    full_name: string
    avatar_key: string | null
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
      u.avatar_key,
      u.role AS user_role,
      s.clock_in_at::text,
      COALESCE(last_pos.lat, s.clock_in_lat) AS lat,
      COALESCE(last_pos.lng, s.clock_in_lng) AS lng,
      COALESCE(last_pos.recorded_at, s.clock_in_at::text) AS last_seen_at
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN LATERAL (
      SELECT b.lat, b.lng, b.recorded_at::text
      FROM gps_breadcrumbs b
      WHERE b.shift_id = s.id AND b.is_gap = false AND b.lat IS NOT NULL
      ORDER BY b.recorded_at DESC
      LIMIT 1
    ) last_pos ON TRUE
    WHERE s.clock_out_at IS NULL
      AND u.role != 'developer'
      AND u.is_active = TRUE
      ${userFilter}
    ORDER BY u.full_name
  `, params)
  const employees = await Promise.all(
    rawEmployees.map(async e => ({
      ...e,
      avatar_url: e.avatar_key ? await getReceiptViewUrl(e.avatar_key) : null,
    }))
  )

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

  const result = { employees, breadcrumbs, stops, stores }

  // Cache org-wide results for canViewAll users (ops, owner, SD, dev all see the same data)
  if (canViewAll && orgFilter.orgId) {
    liveCache = { data: result, orgId: orgFilter.orgId, expiresAt: Date.now() + CACHE_TTL_MS }
  }

  return NextResponse.json(result)
}
