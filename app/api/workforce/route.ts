import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'

const CST = 'America/Chicago'
const ALLOWED = ['employee', 'manager', 'ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer', 'prospect']

// Extract market (state) from store address
function extractMarket(address: string): string {
  const match = address.match(/\b(WI|IA|IL|MN|TX|OH|IN|MI)\b/i)
  if (!match) return 'Other'
  const st = match[1].toUpperCase()
  const marketNames: Record<string, string> = {
    WI: 'Milwaukee', IA: 'Iowa', IL: 'Illinois', MN: 'Minnesota',
    TX: 'Texas', OH: 'Ohio', IN: 'Indiana', MI: 'Michigan',
  }
  return marketNames[st] ?? st
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const weekStart = searchParams.get('weekStart') || getMonday()
  const weekEnd = searchParams.get('weekEnd') || getSunday(weekStart)

  const orgFilter = await getOrgFilter(session)
  const orgWhere = orgFilter.filterByOrg && orgFilter.orgId
    ? `AND u.org_id = '${(orgFilter.orgId as string).replace(/'/g, "''")}'`
    : ''
  const storeOrgWhere = orgFilter.filterByOrg && orgFilter.orgId
    ? `AND sl.org_id = '${(orgFilter.orgId as string).replace(/'/g, "''")}'`
    : ''

  // DMs see all org data (can only EDIT their own district)
  // Employees see only their DM's team
  let dmScopeId: string | null = null
  if (session.role === 'employee') {
    const emp = await query<{ manager_id: string | null }>(`SELECT manager_id FROM users WHERE id = $1`, [session.id])
    dmScopeId = emp[0]?.manager_id ?? null
  }
  const dmWhere = dmScopeId
    ? `AND ms.manager_id = '${dmScopeId.replace(/'/g, "''")}'`
    : ''

  try {
    // Get all DMs with their stores
    const dmStores = await query<{
      dm_id: string; dm_name: string
      store_id: string; store_address: string
    }>(`
      SELECT u.id as dm_id, u.full_name as dm_name,
             sl.id as store_id, sl.address as store_address
      FROM users u
      JOIN dm_manager_stores ms ON ms.manager_id = u.id
      JOIN dm_store_locations sl ON sl.id = ms.store_location_id
      WHERE u.role = 'manager' AND u.is_active = TRUE AND sl.active = TRUE
        AND (u.is_hidden = FALSE OR u.is_hidden IS NULL)
        ${orgWhere}
        ${dmWhere}
      ORDER BY u.full_name, sl.address
    `)

    // Get all employees with their managers
    const employees = await query<{
      id: string; full_name: string; role: string; username: string
      manager_id: string | null; manager_name: string | null
      is_floater: boolean
    }>(`
      SELECT u.id, u.full_name, u.role, u.username,
             u.manager_id, m.full_name as manager_name,
             COALESCE(u.is_floater, FALSE) as is_floater
      FROM users u
      LEFT JOIN users m ON m.id = u.manager_id
      WHERE u.role = 'employee' AND u.is_active = TRUE
        AND (u.is_hidden = FALSE OR u.is_hidden IS NULL)
        ${orgWhere}
        ${dmScopeId ? `AND u.manager_id = '${dmScopeId.replace(/'/g, "''")}'` : ''}
      ORDER BY u.full_name
    `)

    // Get scheduled shifts for the week
    const schedules = await query<{
      id: string; employee_id: string; store_id: string | null; store_address: string | null
      shift_date: string; start_time: string | null; end_time: string | null
      break_minutes: number | null
    }>(`
      SELECT ss.id, ss.employee_id, ss.store_location_id as store_id,
             sl.address as store_address,
             ss.shift_date::text, ss.start_time::text, ss.end_time::text,
             ss.break_minutes
      FROM scheduled_shifts ss
      LEFT JOIN dm_store_locations sl ON sl.id = ss.store_location_id
      WHERE ss.shift_date >= $1::date AND ss.shift_date <= $2::date
        ${storeOrgWhere.replace(/sl\./g, 'sl.')}
      ORDER BY ss.shift_date, ss.start_time
    `, [weekStart, weekEnd])

    // Get actual shifts (clock in/out) for the week
    const shifts = await query<{
      id: string; user_id: string; store_id: string | null; store_address: string | null
      clock_in_at: string; clock_out_at: string | null
      is_manual: boolean; manual_note: string | null
      duration_seconds: number
    }>(`
      SELECT s.id, s.user_id, s.store_location_id as store_id,
             sl.address as store_address,
             s.clock_in_at::text, s.clock_out_at::text,
             s.is_manual, s.manual_note,
             EXTRACT(EPOCH FROM (COALESCE(s.clock_out_at, NOW()) - s.clock_in_at))
               - COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start)))
                 FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)
               AS duration_seconds
      FROM shifts s
      LEFT JOIN dm_store_locations sl ON sl.id = s.store_location_id
      JOIN users u ON u.id = s.user_id
      WHERE (s.clock_in_at AT TIME ZONE $3)::date >= $1::date
        AND (s.clock_in_at AT TIME ZONE $3)::date <= $2::date
        ${orgWhere.replace(/u\./g, 'u.')}
        ${dmScopeId ? `AND u.manager_id = '${dmScopeId.replace(/'/g, "''")}'` : ''}
      ORDER BY s.clock_in_at
    `, [weekStart, weekEnd, CST])

    // Get time exceptions: manual entries + timecard-related flags (auto clock-out, overtime, missed punch)
    const manualEntries = await query<{ user_id: string; count: string }>(`
      SELECT s.user_id, COUNT(*)::text as count
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      WHERE (s.clock_in_at AT TIME ZONE $3)::date >= $1::date
        AND (s.clock_in_at AT TIME ZONE $3)::date <= $2::date
        AND s.is_manual = TRUE
        ${orgWhere.replace(/u\./g, 'u.')}
        ${dmScopeId ? `AND u.manager_id = '${dmScopeId.replace(/'/g, "''")}'` : ''}
      GROUP BY s.user_id
    `, [weekStart, weekEnd, CST])
    const timecardFlags = await query<{ user_id: string; count: string }>(`
      SELECT f.user_id, COUNT(*)::text as count
      FROM flags f
      JOIN users u ON u.id = f.user_id
      WHERE f.date >= $1::date AND f.date <= $2::date
        AND f.type IN ('auto_clockout', 'overtime', 'missing_clock_in_photo', 'break_long', 'break_multiple', 'geofence_exit')
        ${orgWhere.replace(/u\./g, 'u.')}
        ${dmScopeId ? `AND u.manager_id = '${dmScopeId.replace(/'/g, "''")}'` : ''}
      GROUP BY f.user_id
    `, [weekStart, weekEnd]).catch(() => [])
    // Merge both counts per user
    const exceptions: Record<string, number> = {}
    for (const e of manualEntries) exceptions[e.user_id] = (exceptions[e.user_id] ?? 0) + parseInt(e.count)
    for (const f of timecardFlags) exceptions[f.user_id] = (exceptions[f.user_id] ?? 0) + parseInt(f.count)

    // Store closures for the week
    const closures = await query<{ store_id: string; closure_date: string }>(`
      SELECT store_id, closure_date::text FROM store_closures
      WHERE closure_date >= $1::date AND closure_date <= $2::date
    `, [weekStart, weekEnd])

    // Live coverage: stores with at least one person currently clocked in
    const coveredStores = await query<{ store_id: string; clocked_in: string }>(`
      SELECT s.store_location_id as store_id, COUNT(DISTINCT s.user_id)::text as clocked_in
      FROM shifts s
      WHERE s.clock_out_at IS NULL AND s.store_location_id IS NOT NULL
      GROUP BY s.store_location_id
    `).catch(() => [])
    const coveredStoreIds = new Set(coveredStores.map(c => c.store_id))

    // Build DM → stores map (each DM appears ONCE with ALL their stores)
    const dmMap = new Map<string, { id: string; name: string; stores: Array<{ id: string; address: string; market: string }> }>()
    const storeMarketMap = new Map<string, string>() // store_id → market name

    for (const ds of dmStores) {
      const market = extractMarket(ds.store_address)
      storeMarketMap.set(ds.store_id, market)
      if (!dmMap.has(ds.dm_id)) {
        dmMap.set(ds.dm_id, { id: ds.dm_id, name: ds.dm_name, stores: [] })
      }
      const dm = dmMap.get(ds.dm_id)!
      if (!dm.stores.find(s => s.id === ds.store_id)) {
        dm.stores.push({ id: ds.store_id, address: ds.store_address, market })
      }
    }

    // Markets: unique list with store counts
    const marketNames = new Set(dmStores.map(ds => extractMarket(ds.store_address)))
    const markets = Array.from(marketNames).sort().map(name => ({
      name,
      storeIds: dmStores.filter(ds => extractMarket(ds.store_address) === name).map(ds => ds.store_id),
      dmIds: Array.from(new Set(dmStores.filter(ds => extractMarket(ds.store_address) === name).map(ds => ds.dm_id))),
    }))

    // All DMs with all their stores (never duplicated)
    const allDms = Array.from(dmMap.values()).sort((a, b) => a.name.localeCompare(b.name))

    // All stores flat list
    const allStores = dmStores
      .filter((s, i, arr) => arr.findIndex(x => x.store_id === s.store_id) === i)
      .map(s => ({ id: s.store_id, address: s.store_address, market: extractMarket(s.store_address) }))
      .sort((a, b) => a.address.localeCompare(b.address))

    return NextResponse.json({
      markets,
      allStores,
      allDms,
      employees,
      schedules,
      shifts,
      exceptions,
      closures,
      coveredStoreIds: Array.from(coveredStoreIds),
      weekStart,
      weekEnd,
    })
  } catch (err) {
    console.error('Workforce API error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

function getMonday(): string {
  const now = new Date()
  const cst = new Date(now.toLocaleString('en-US', { timeZone: CST }))
  const day = cst.getDay()
  const diff = day === 0 ? 6 : day - 1
  cst.setDate(cst.getDate() - diff)
  return cst.toLocaleDateString('en-CA')
}

function getSunday(monday: string): string {
  const d = new Date(monday + 'T12:00:00')
  d.setDate(d.getDate() + 6)
  return d.toLocaleDateString('en-CA')
}
