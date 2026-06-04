import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'
import { computeStops, matchStopsToStores, type StoreLocation } from '@/lib/gps'
import { getReceiptViewUrl } from '@/lib/s3'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const canViewAll = isOwner(session.role) || session.role === 'ops_manager' || session.role === 'developer'
  const isDM = session.role === 'manager'

  if (userId && userId !== session.id && !canViewAll && !isDM) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = []
  let dateFilter = ''
  if (from) { params.push(from); dateFilter += ` AND s.clock_in_at >= $${params.length}` }
  if (to) { params.push(to); dateFilter += ` AND s.clock_in_at <= $${params.length}` }

  let shifts: unknown[]

  if (userId) {
    // Specific user requested — DMs may only request themselves or their direct employees
    if (isDM && userId !== session.id) {
      const allowed = await query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1 AND manager_id = $2 AND role = 'employee'`,
        [userId, session.id]
      )
      if (allowed.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const reIndexed: unknown[] = [userId]
    if (from) reIndexed.push(from)
    if (to) reIndexed.push(to)
    params.length = 0
    params.push(...reIndexed)

    let df = ''
    let i = 2
    if (from) { df += ` AND s.clock_in_at >= $${i++}` }
    if (to) { df += ` AND s.clock_in_at <= $${i++}` }

    shifts = await query(`
      SELECT s.id, s.user_id, s.clock_in_at, s.clock_in_lat, s.clock_in_lng, s.clock_in_address,
             s.clock_out_at, s.clock_out_lat, s.clock_out_lng, s.clock_out_address,
             u.full_name, u.username, u.role AS user_role, u.avatar_key
      FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE s.user_id = $1${df}
      ORDER BY s.clock_in_at DESC LIMIT 50
    `, params)
  } else if (canViewAll) {
    // Owners / developer see all users in org
    const orgClause = appendOrgFilter(orgFilter, params)
    shifts = await query(`
      SELECT s.id, s.user_id, s.clock_in_at, s.clock_in_lat, s.clock_in_lng, s.clock_in_address,
             s.clock_out_at, s.clock_out_lat, s.clock_out_lng, s.clock_out_address,
             u.full_name, u.username, u.role AS user_role, u.avatar_key
      FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE 1=1${dateFilter}${orgClause}
      ORDER BY s.clock_in_at DESC LIMIT 200
    `, params)
  } else if (isDM) {
    // DM sees only themselves + their direct employees (role = 'employee')
    const reIndexed: unknown[] = [session.id]
    if (from) reIndexed.push(from)
    if (to) reIndexed.push(to)
    params.length = 0
    params.push(...reIndexed)

    let df = ''
    let i = 2
    if (from) { df += ` AND s.clock_in_at >= $${i++}` }
    if (to) { df += ` AND s.clock_in_at <= $${i++}` }

    shifts = await query(`
      SELECT s.id, s.user_id, s.clock_in_at, s.clock_in_lat, s.clock_in_lng, s.clock_in_address,
             s.clock_out_at, s.clock_out_lat, s.clock_out_lng, s.clock_out_address,
             u.full_name, u.username, u.role AS user_role
      FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE (s.user_id = $1 OR (u.manager_id = $1 AND u.role = 'employee'))${df}
      ORDER BY s.clock_in_at DESC LIMIT 200
    `, params)
  } else {
    // Employee sees only their own
    const reIndexed: unknown[] = [session.id]
    if (from) reIndexed.push(from)
    if (to) reIndexed.push(to)
    params.length = 0
    params.push(...reIndexed)

    let df = ''
    let i = 2
    if (from) { df += ` AND s.clock_in_at >= $${i++}` }
    if (to) { df += ` AND s.clock_in_at <= $${i++}` }

    shifts = await query(`
      SELECT s.id, s.user_id, s.clock_in_at, s.clock_in_lat, s.clock_in_lng, s.clock_in_address,
             s.clock_out_at, s.clock_out_lat, s.clock_out_lng, s.clock_out_address,
             u.full_name, u.username, u.role AS user_role, u.avatar_key
      FROM shifts s JOIN users u ON u.id = s.user_id
      WHERE s.user_id = $1${df}
      ORDER BY s.clock_in_at DESC LIMIT 50
    `, params)
  }

  // Compute avatar URLs from keys
  shifts = await Promise.all(
    (shifts as Record<string, unknown>[]).map(async s => ({
      ...s,
      avatar_url: s.avatar_key ? await getReceiptViewUrl(s.avatar_key as string) : null,
    }))
  )

  // Fetch breadcrumbs only for DM (manager) shifts, and only for roles that can see paths
  const canSeePaths = ['sales_director', 'ops_manager', 'owner', 'developer'].includes(session.role)
  const dmShiftIds = canSeePaths
    ? (shifts as { id: string; user_role: string }[])
        .filter(s => s.user_role === 'manager')
        .map(s => s.id)
    : []

  const breadcrumbs = dmShiftIds.length > 0
    ? await query(`
        SELECT b.shift_id, b.lat, b.lng, b.recorded_at, b.is_gap
        FROM gps_breadcrumbs b
        WHERE b.shift_id = ANY($1) ORDER BY b.recorded_at ASC
      `, [dmShiftIds])
    : []

  const rawStops = computeStops(
    (breadcrumbs as { shift_id: string; lat: number; lng: number; recorded_at: string; is_gap: boolean }[])
      .filter(b => !b.is_gap)
  )

  // Fetch store locations for all DM shifts to match stops + render store pins
  const dmUserIds = (shifts as { id: string; user_role: string; user_id?: string }[])
    .filter(s => s.user_role === 'manager' && s.user_id)
    .map(s => s.user_id!)
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

  return NextResponse.json({ shifts, breadcrumbs, stops, stores })
}
