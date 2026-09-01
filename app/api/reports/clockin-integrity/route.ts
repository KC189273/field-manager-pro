import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const CST = 'America/Chicago'

// Payroll period anchor — same as payroll/route.ts
const ANCHOR = new Date(Date.UTC(2026, 2, 30, 12, 0, 0))

function getCurrentPeriod(): { start: string; end: string } {
  const now = new Date()
  const daysSince = Math.floor((now.getTime() - ANCHOR.getTime()) / 86400000)
  const idx = Math.floor(daysSince / 14)
  const start = new Date(ANCHOR)
  start.setUTCDate(start.getUTCDate() + idx * 14)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 13)
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // DMs can see their own, leadership can see all
  const canViewAll = ['ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role)
  if (!canViewAll && !isManager(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const period = getCurrentPeriod()
  const from = searchParams.get('from') || period.start
  const to = searchParams.get('to') || period.end
  const dmId = searchParams.get('dmId') // specific DM drill-down

  const orgId = session.org_id
  const orgFilter = orgId ? `AND u.org_id = '${(orgId as string).replace(/'/g, "''")}'` : ''

  try {
    // Get thresholds
    const amberRow = await queryOne<{ value: unknown }>(`SELECT value FROM dev_config WHERE key = 'integrity_amber_threshold'`).catch(() => null)
    const redRow = await queryOne<{ value: unknown }>(`SELECT value FROM dev_config WHERE key = 'integrity_red_threshold'`).catch(() => null)
    const amberThreshold = Number(amberRow?.value) || 20
    const redThreshold = Number(redRow?.value) || 30

    if (dmId || (session.role === 'manager' && !canViewAll)) {
      // Single DM view — show per-employee breakdown
      const targetDmId = dmId || session.id

      const employees = await query<{
        emp_id: string; emp_name: string
        total_shifts: number; live_shifts: number; manual_shifts: number; edited_shifts: number
        manual_by_names: string | null
        late_manual_count: number
      }>(`
        SELECT
          u.id as emp_id, u.full_name as emp_name,
          COUNT(*)::int as total_shifts,
          COUNT(*) FILTER (WHERE COALESCE(s.is_manual, FALSE) = FALSE)::int as live_shifts,
          COUNT(*) FILTER (WHERE s.is_manual = TRUE)::int as manual_shifts,
          COUNT(DISTINCT se.shift_id)::int as edited_shifts,
          STRING_AGG(DISTINCT mb.full_name, ', ') FILTER (WHERE s.is_manual = TRUE) as manual_by_names,
          COUNT(*) FILTER (WHERE s.is_manual = TRUE AND s.clock_in_at::date < (s.created_at AT TIME ZONE '${CST}')::date - 1)::int as late_manual_count
        FROM shifts s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN users mb ON mb.id = s.manual_by
        LEFT JOIN shift_edits se ON se.shift_id = s.id
        WHERE u.manager_id = $1
          AND u.role = 'employee' AND u.is_active = TRUE
          AND (s.clock_in_at AT TIME ZONE '${CST}')::date >= $2::date
          AND (s.clock_in_at AT TIME ZONE '${CST}')::date <= $3::date
          ${orgFilter}
        GROUP BY u.id, u.full_name
        ORDER BY manual_shifts DESC, u.full_name
      `, [targetDmId, from, to])

      const totalAll = employees.reduce((s, e) => s + e.total_shifts, 0)
      const manualAll = employees.reduce((s, e) => s + e.manual_shifts, 0)
      const editedAll = employees.reduce((s, e) => s + e.edited_shifts, 0)
      const interventionRate = totalAll > 0 ? Math.round(((manualAll + editedAll) / totalAll) * 100) : 0

      return NextResponse.json({
        view: 'dm_detail',
        from, to, currentPeriod: period,
        thresholds: { amber: amberThreshold, red: redThreshold },
        summary: { totalShifts: totalAll, manualEntries: manualAll, editedShifts: editedAll, interventionRate },
        employees,
      })
    }

    // All DMs view
    const dmStats = await query<{
      dm_id: string; dm_name: string
      total_shifts: number; live_shifts: number; manual_shifts: number; edited_shifts: number
      manual_rate: number; edit_rate: number; intervention_rate: number
      employee_count: number
    }>(`
      SELECT
        m.id as dm_id, m.full_name as dm_name,
        COUNT(*)::int as total_shifts,
        COUNT(*) FILTER (WHERE COALESCE(s.is_manual, FALSE) = FALSE)::int as live_shifts,
        COUNT(*) FILTER (WHERE s.is_manual = TRUE)::int as manual_shifts,
        COUNT(DISTINCT se.shift_id)::int as edited_shifts,
        CASE WHEN COUNT(*) > 0 THEN ROUND((COUNT(*) FILTER (WHERE s.is_manual = TRUE)::numeric / COUNT(*)::numeric) * 100)::int ELSE 0 END as manual_rate,
        CASE WHEN COUNT(*) > 0 THEN ROUND((COUNT(DISTINCT se.shift_id)::numeric / COUNT(*)::numeric) * 100)::int ELSE 0 END as edit_rate,
        CASE WHEN COUNT(*) > 0 THEN ROUND(((COUNT(*) FILTER (WHERE s.is_manual = TRUE) + COUNT(DISTINCT se.shift_id))::numeric / COUNT(*)::numeric) * 100)::int ELSE 0 END as intervention_rate,
        COUNT(DISTINCT u.id)::int as employee_count
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      JOIN users m ON m.id = u.manager_id
      LEFT JOIN shift_edits se ON se.shift_id = s.id
      WHERE m.role = 'manager' AND m.is_active = TRUE
        AND u.role = 'employee' AND u.is_active = TRUE
        AND (s.clock_in_at AT TIME ZONE '${CST}')::date >= $1::date
        AND (s.clock_in_at AT TIME ZONE '${CST}')::date <= $2::date
        ${orgFilter}
      GROUP BY m.id, m.full_name
      ORDER BY intervention_rate DESC, m.full_name
    `, [from, to])

    return NextResponse.json({
      view: 'all_dms',
      from, to, currentPeriod: period,
      thresholds: { amber: amberThreshold, red: redThreshold },
      dmStats,
    })
  } catch (err) {
    console.error('Clock-in integrity error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
