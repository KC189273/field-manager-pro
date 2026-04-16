import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'

const CST = 'America/Chicago'

function getLastClosedWeek(): { start: string; end: string } {
  const now = new Date()
  const cstDate = new Date(now.toLocaleString('en-US', { timeZone: CST }))
  const dayOfWeek = cstDate.getDay() // 0=Sun
  const lastSunday = new Date(cstDate)
  lastSunday.setDate(cstDate.getDate() - dayOfWeek)
  const lastMonday = new Date(lastSunday)
  lastMonday.setDate(lastSunday.getDate() - 6)
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  return { start: fmt(lastMonday), end: fmt(lastSunday) }
}

async function getOrgId(session: { role: string; id: string; org_id?: string | null }): Promise<string | null> {
  if (session.org_id) return session.org_id
  const row = await queryOne<{ org_id: string | null }>('SELECT org_id FROM users WHERE id = $1', [session.id])
  return row?.org_id ?? null
}

async function getPeriodHours(orgId: string, periodStart: string, periodEnd: string) {
  const endExclusive = new Date(periodEnd)
  endExclusive.setDate(endExclusive.getDate() + 1)
  const endStr = endExclusive.toISOString().split('T')[0]

  return query<{
    user_id: string
    full_name: string
    username: string
    manager_id: string | null
    regular_hours: number
    ot_hours: number
    total_hours: number
  }>(`
    WITH weekly_hours AS (
      SELECT
        s.user_id,
        u.full_name,
        u.username,
        u.manager_id,
        DATE_TRUNC('week', s.clock_in_at AT TIME ZONE $4)::date AS week_start,
        SUM(EXTRACT(EPOCH FROM (s.clock_out_at - s.clock_in_at)) / 3600.0) AS total_hours
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      WHERE s.clock_out_at IS NOT NULL
        AND (s.clock_in_at AT TIME ZONE $4)::date >= $1::date
        AND (s.clock_in_at AT TIME ZONE $4)::date < $2::date
        AND u.org_id = $3
        AND u.role = 'employee'
      GROUP BY s.user_id, u.full_name, u.username, u.manager_id, week_start
    )
    SELECT
      user_id, full_name, username, manager_id,
      ROUND(SUM(LEAST(total_hours, 40))::numeric, 2)::float AS regular_hours,
      ROUND(SUM(GREATEST(total_hours - 40, 0))::numeric, 2)::float AS ot_hours,
      ROUND(SUM(total_hours)::numeric, 2)::float AS total_hours
    FROM weekly_hours
    GROUP BY user_id, full_name, username, manager_id
    ORDER BY full_name
  `, [periodStart, endStr, orgId, CST])
}

// GET — returns periods + approval status + (for DM) their employees' hours
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const orgId = await getOrgId(session)
  if (!orgId) return NextResponse.json({ periods: [], hours: [] })

  const { start, end } = getLastClosedWeek()

  // Ensure most recent period exists
  await queryOne(`
    INSERT INTO payroll_periods (org_id, period_start, period_end)
    VALUES ($1, $2, $3)
    ON CONFLICT (org_id, period_start) DO NOTHING
  `, [orgId, start, end])

  // Fetch last 8 periods for this org
  const periods = await query<{
    id: string
    period_start: string
    period_end: string
    status: string
    sr_approved_by: string | null
    sr_approved_at: string | null
    sr_approver_name: string | null
  }>(`
    SELECT
      pp.id, pp.period_start::text, pp.period_end::text, pp.status,
      pp.sr_approved_by, pp.sr_approved_at::text,
      u.full_name AS sr_approver_name
    FROM payroll_periods pp
    LEFT JOIN users u ON u.id = pp.sr_approved_by
    WHERE pp.org_id = $1
    ORDER BY pp.period_start DESC
    LIMIT 8
  `, [orgId])

  // Get DM approvals for all returned periods
  const periodIds = periods.map(p => p.id)
  const dmApprovals = periodIds.length > 0 ? await query<{
    period_id: string
    dm_id: string
    dm_name: string
    approved_at: string
  }>(`
    SELECT pda.period_id, pda.dm_id, u.full_name AS dm_name, pda.approved_at::text
    FROM payroll_dm_approvals pda
    JOIN users u ON u.id = pda.dm_id
    WHERE pda.period_id = ANY($1)
  `, [periodIds]) : []

  // Get total DM count for the org
  const dmCount = await queryOne<{ count: string }>(`
    SELECT COUNT(*)::text AS count FROM users
    WHERE org_id = $1 AND role = 'manager' AND is_active = TRUE
  `, [orgId])
  const totalDMs = parseInt(dmCount?.count ?? '0')

  // For DMs: get their employees' hours for the current period
  let myEmployeeHours: { user_id: string; full_name: string; regular_hours: number; ot_hours: number; total_hours: number }[] = []
  if (session.role === 'manager' && periods.length > 0) {
    const currentPeriod = periods[0]
    const allHours = await getPeriodHours(orgId, currentPeriod.period_start, currentPeriod.period_end)
    myEmployeeHours = allHours.filter(h => h.manager_id === session.id)
  }

  return NextResponse.json({
    periods: periods.map(p => ({
      ...p,
      dmApprovals: dmApprovals.filter(a => a.period_id === p.id),
      totalDMs,
    })),
    myEmployeeHours,
    role: session.role,
    userId: session.id,
  })
}
