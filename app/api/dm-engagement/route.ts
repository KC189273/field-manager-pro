import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'

const canAccess = (role: string) =>
  role === 'ops_manager' || role === 'sales_director' || role === 'owner' || role === 'developer'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccess(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const fromTs = from ? `${from}T00:00:00Z` : new Date(Date.now() - 30 * 86400000).toISOString()
  const toTs = to ? `${to}T23:59:59Z` : new Date().toISOString()

  const orgFilter = await getOrgFilter(session)
  const orgId = orgFilter.filterByOrg ? orgFilter.orgId : null

  // Get all active DMs in org
  const dms = await query<{ dm_id: string; dm_name: string; store_count: number }>(
    `SELECT u.id AS dm_id, u.full_name AS dm_name,
            COUNT(ms.store_location_id)::int AS store_count
     FROM users u
     LEFT JOIN dm_manager_stores ms ON ms.manager_id = u.id
     WHERE u.role = 'manager' AND u.is_active = TRUE
       ${orgId ? 'AND u.org_id = $1' : orgFilter.filterByOrg ? 'AND u.org_id IS NULL' : ''}
     GROUP BY u.id, u.full_name
     ORDER BY u.full_name`,
    orgId ? [orgId] : []
  )

  if (dms.length === 0) return NextResponse.json({ dms: [] })
  const dmIds = dms.map(d => d.dm_id)

  const [visits, checklists, tasks, schedules, payroll, lastActive, accountability, supplyAvg, facilityTickets, openFacilityTickets, merchOrders] = await Promise.all([
    query<{ dm_id: string; count: number }>(
      `SELECT submitted_by_id AS dm_id, COUNT(*)::int AS count
       FROM dm_store_visits
       WHERE submitted_by_id = ANY($1) AND submitted_at >= $2 AND submitted_at <= $3
       GROUP BY submitted_by_id`,
      [dmIds, fromTs, toTs]
    ).catch(() => []),

    query<{ dm_id: string; count: number }>(
      `SELECT dm_id, COUNT(*)::int AS count
       FROM checklist_submissions
       WHERE dm_id = ANY($1) AND submitted_at >= $2 AND submitted_at <= $3
       GROUP BY dm_id`,
      [dmIds, fromTs, toTs]
    ).catch(() => []),

    query<{ dm_id: string; count: number }>(
      `SELECT created_by AS dm_id, COUNT(*)::int AS count
       FROM tasks
       WHERE created_by = ANY($1) AND created_at >= $2 AND created_at <= $3
       GROUP BY created_by`,
      [dmIds, fromTs, toTs]
    ).catch(() => []),

    query<{ dm_id: string; count: number }>(
      `SELECT ms.manager_id AS dm_id, COUNT(*)::int AS count
       FROM scheduled_shifts_publish ssp
       JOIN dm_manager_stores ms ON ms.store_location_id = ssp.store_location_id
       WHERE ms.manager_id = ANY($1) AND ssp.published_at >= $2 AND ssp.published_at <= $3
       GROUP BY ms.manager_id`,
      [dmIds, fromTs, toTs]
    ).catch(() => []),

    query<{ dm_id: string; count: number }>(
      `SELECT pda.dm_id, COUNT(*)::int AS count
       FROM payroll_dm_approvals pda
       WHERE pda.dm_id = ANY($1) AND pda.approved_at >= $2 AND pda.approved_at <= $3
       GROUP BY pda.dm_id`,
      [dmIds, fromTs, toTs]
    ).catch(() => []),

    // Last activity timestamp per DM (clock-in, store visit, task assigned, checklist)
    query<{ dm_id: string; last_active_at: string }>(
      `SELECT u.id AS dm_id,
              GREATEST(
                MAX(s.clock_in_at),
                MAX(v.submitted_at),
                MAX(t.created_at),
                MAX(cs.submitted_at)
              )::text AS last_active_at
       FROM users u
       LEFT JOIN shifts s ON s.user_id = u.id
       LEFT JOIN dm_store_visits v ON v.submitted_by_id = u.id
       LEFT JOIN tasks t ON t.created_by = u.id
       LEFT JOIN checklist_submissions cs ON cs.dm_id = u.id
       WHERE u.id = ANY($1)
       GROUP BY u.id`,
      [dmIds]
    ).catch(() => []),

    // Accountability docs submitted by each DM
    query<{ dm_id: string; count: number }>(
      `SELECT author_id AS dm_id, COUNT(*)::int AS count
       FROM accountability_docs
       WHERE author_id = ANY($1) AND author_role = 'manager' AND created_at >= $2 AND created_at <= $3
       GROUP BY author_id`,
      [dmIds, fromTs, toTs]
    ).catch(() => []),

    // Supply request avg response time (created → received, within range)
    query<{ dm_id: string; avg_hours: string | null }>(
      `SELECT manager_id AS dm_id,
              ROUND(AVG(EXTRACT(EPOCH FROM (received_at - created_at)) / 3600), 1)::text AS avg_hours
       FROM supply_requests
       WHERE manager_id = ANY($1)
         AND status = 'received'
         AND created_at >= $2 AND created_at <= $3
       GROUP BY manager_id`,
      [dmIds, fromTs, toTs]
    ).catch(() => []),

    // Facility tickets at stores managed by each DM (submitted in range)
    query<{ dm_id: string; count: number }>(
      `SELECT ms.manager_id AS dm_id, COUNT(*)::int AS count
       FROM facility_tickets ft
       JOIN dm_manager_stores ms ON ms.store_location_id = ft.store_id
       WHERE ms.manager_id = ANY($1) AND ft.created_at >= $2 AND ft.created_at <= $3
       GROUP BY ms.manager_id`,
      [dmIds, fromTs, toTs]
    ).catch(() => []),

    // Open (unresolved) facility tickets per DM — current state, no date filter
    query<{ dm_id: string; count: number }>(
      `SELECT ms.manager_id AS dm_id, COUNT(*)::int AS count
       FROM facility_tickets ft
       JOIN dm_manager_stores ms ON ms.store_location_id = ft.store_id
       WHERE ms.manager_id = ANY($1) AND ft.status IN ('open', 'in_progress')
       GROUP BY ms.manager_id`,
      [dmIds]
    ).catch(() => []),

    // Merch orders for each DM's team
    query<{ dm_id: string; count: number }>(
      `SELECT manager_id AS dm_id, COUNT(*)::int AS count
       FROM merch_orders
       WHERE manager_id = ANY($1) AND created_at >= $2 AND created_at <= $3
       GROUP BY manager_id`,
      [dmIds, fromTs, toTs]
    ).catch(() => []),
  ])

  const visitMap = new Map(visits.map(r => [r.dm_id, r.count]))
  const checklistMap = new Map(checklists.map(r => [r.dm_id, r.count]))
  const taskMap = new Map(tasks.map(r => [r.dm_id, r.count]))
  const scheduleMap = new Map(schedules.map(r => [r.dm_id, r.count]))
  const payrollMap = new Map(payroll.map(r => [r.dm_id, r.count]))
  const lastActiveMap = new Map(lastActive.map(r => [r.dm_id, r.last_active_at]))
  const accountabilityMap = new Map(accountability.map(r => [r.dm_id, r.count]))
  const supplyAvgMap = new Map(supplyAvg.map(r => [r.dm_id, r.avg_hours ? parseFloat(r.avg_hours) : null]))
  const facilityMap = new Map(facilityTickets.map(r => [r.dm_id, r.count]))
  const openFacilityMap = new Map(openFacilityTickets.map(r => [r.dm_id, r.count]))
  const merchMap = new Map(merchOrders.map(r => [r.dm_id, r.count]))

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const result = dms.map(dm => {
    const lastActiveAt = lastActiveMap.get(dm.dm_id) ?? null
    const inactive = !lastActiveAt || new Date(lastActiveAt) < oneDayAgo
    return {
      dm_id: dm.dm_id,
      dm_name: dm.dm_name,
      store_count: dm.store_count,
      store_visits: visitMap.get(dm.dm_id) ?? 0,
      checklists: checklistMap.get(dm.dm_id) ?? 0,
      tasks_assigned: taskMap.get(dm.dm_id) ?? 0,
      schedules_published: scheduleMap.get(dm.dm_id) ?? 0,
      payroll_submitted: payrollMap.get(dm.dm_id) ?? 0,
      accountability_docs: accountabilityMap.get(dm.dm_id) ?? 0,
      supply_avg_response_hours: supplyAvgMap.get(dm.dm_id) ?? null,
      facility_tickets: facilityMap.get(dm.dm_id) ?? 0,
      open_facility_tickets: openFacilityMap.get(dm.dm_id) ?? 0,
      merch_orders: merchMap.get(dm.dm_id) ?? 0,
      last_active_at: lastActiveAt,
      inactive_24h: inactive,
    }
  })

  return NextResponse.json({ dms: result })
}
