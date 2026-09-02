import { NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { query } from '@/lib/db'

const CST = 'America/Chicago'

export async function GET() {
  const session = await getSession()
  if (!session || (!isManager(session.role) && session.role !== 'developer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const orgId = session.org_id
  const orgFilter = orgId ? `AND u_dm.org_id = '${(orgId as string).replace(/'/g, "''")}'` : ''
  const todayCST = new Date().toLocaleDateString('en-CA', { timeZone: CST })

  try {
    // Get all DMs with their assigned stores
    const dms = await query<{
      dm_id: string; dm_name: string
      store_id: string; store_address: string; store_active: boolean
      closed_today: boolean
    }>(`
      SELECT u_dm.id as dm_id, u_dm.full_name as dm_name,
             dsl.id as store_id, dsl.address as store_address, dsl.active as store_active,
             EXISTS(SELECT 1 FROM store_closures sc WHERE sc.store_id = dsl.id AND sc.closure_date = CURRENT_DATE) as closed_today
      FROM users u_dm
      JOIN dm_manager_stores dms ON dms.manager_id = u_dm.id
      JOIN dm_store_locations dsl ON dsl.id = dms.store_location_id
      WHERE u_dm.role = 'manager' AND u_dm.is_active = TRUE AND dsl.active = TRUE
        ${orgFilter}
      ORDER BY u_dm.full_name, dsl.address
    `)

    // Get all currently clocked-in employees with their stores
    const clockedIn = await query<{
      user_id: string; full_name: string; store_id: string | null
      store_address: string | null; clock_in_at: string; manager_id: string | null
      hours_so_far: number
    }>(`
      SELECT s.user_id, u.full_name, s.store_location_id as store_id,
             dsl.address as store_address, s.clock_in_at::text,
             u.manager_id,
             ROUND(EXTRACT(EPOCH FROM (NOW() - s.clock_in_at)) / 3600.0, 1)::float as hours_so_far
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN dm_store_locations dsl ON dsl.id = s.store_location_id
      WHERE s.clock_out_at IS NULL AND u.role = 'employee' AND u.is_active = TRUE
        ${orgFilter ? orgFilter.replace('u_dm', 'u') : ''}
      ORDER BY u.full_name
    `)

    // Get today's scheduled shifts (not yet started or in progress)
    const scheduled = await query<{
      employee_id: string; full_name: string; store_id: string | null
      store_address: string | null; start_time: string; end_time: string | null
      manager_id: string | null; is_clocked_in: boolean
    }>(`
      SELECT ss.employee_id, u.full_name, ss.store_location_id as store_id,
             dsl.address as store_address,
             ss.start_time::text, ss.end_time::text,
             u.manager_id,
             EXISTS(SELECT 1 FROM shifts sh WHERE sh.user_id = ss.employee_id AND sh.clock_out_at IS NULL) as is_clocked_in
      FROM scheduled_shifts ss
      JOIN users u ON u.id = ss.employee_id
      LEFT JOIN dm_store_locations dsl ON dsl.id = ss.store_location_id
      WHERE ss.shift_date = $1
        AND u.is_active = TRUE AND u.role = 'employee'
        AND ss.is_dm_shift = FALSE
        ${orgFilter ? orgFilter.replace('u_dm', 'u') : ''}
      ORDER BY ss.start_time, u.full_name
    `, [todayCST])

    // Build structured response grouped by DM → Store
    interface StoreData {
      store_id: string; address: string; closed_today: boolean
      clocked_in: Array<{ name: string; clock_in_at: string; hours: number }>
      scheduled: Array<{ name: string; start_time: string; end_time: string | null; clocked_in: boolean }>
    }
    interface DmData {
      dm_id: string; dm_name: string
      stores: StoreData[]
      total_clocked_in: number; total_stores: number; stores_covered: number
    }

    const dmMap = new Map<string, DmData>()

    // Init DMs and stores from assignments
    for (const row of dms) {
      if (!dmMap.has(row.dm_id)) {
        dmMap.set(row.dm_id, { dm_id: row.dm_id, dm_name: row.dm_name, stores: [], total_clocked_in: 0, total_stores: 0, stores_covered: 0 })
      }
      const dm = dmMap.get(row.dm_id)!
      if (!dm.stores.find(s => s.store_id === row.store_id)) {
        dm.stores.push({ store_id: row.store_id, address: row.store_address, closed_today: row.closed_today, clocked_in: [], scheduled: [] })
        if (!row.closed_today) dm.total_stores++
      }
    }

    // Assign clocked-in employees to stores
    for (const emp of clockedIn) {
      if (!emp.store_id) continue
      for (const dm of dmMap.values()) {
        const store = dm.stores.find(s => s.store_id === emp.store_id)
        if (store) {
          store.clocked_in.push({ name: emp.full_name, clock_in_at: emp.clock_in_at, hours: emp.hours_so_far })
          dm.total_clocked_in++
        }
      }
    }

    // Assign scheduled shifts to stores
    for (const sch of scheduled) {
      if (!sch.store_id) continue
      for (const dm of dmMap.values()) {
        const store = dm.stores.find(s => s.store_id === sch.store_id)
        if (store) {
          store.scheduled.push({ name: sch.full_name, start_time: sch.start_time, end_time: sch.end_time, clocked_in: sch.is_clocked_in })
        }
      }
    }

    // Count covered stores
    for (const dm of dmMap.values()) {
      dm.stores_covered = dm.stores.filter(s => !s.closed_today && s.clocked_in.length > 0).length
    }

    const result = Array.from(dmMap.values()).sort((a, b) => a.dm_name.localeCompare(b.dm_name))

    return NextResponse.json({
      dms: result,
      totalClockedIn: clockedIn.length,
      totalScheduled: scheduled.filter(s => !s.is_clocked_in).length,
      asOf: new Date().toLocaleTimeString('en-US', { timeZone: CST, hour: 'numeric', minute: '2-digit' }),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
