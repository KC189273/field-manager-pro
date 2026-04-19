import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const CST = 'America/Chicago'
const ANCHOR = new Date('2026-03-30T12:00:00.000Z')

function getBiWeeklyPeriods(): { start: string; end: string; periodIndex: number }[] {
  const now = new Date()
  const daysSince = Math.floor((now.getTime() - ANCHOR.getTime()) / 86400000)
  const currentPeriodIdx = Math.floor(daysSince / 14)
  const results = []
  for (let i = currentPeriodIdx; i >= Math.max(0, currentPeriodIdx - 3); i--) {
    const start = new Date(ANCHOR)
    start.setUTCDate(start.getUTCDate() + i * 14)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 13)
    results.push({
      periodIndex: i,
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
    })
  }
  return results
}

function getLastClosedPeriod(): { start: string; end: string } | null {
  const now = new Date()
  const daysSince = Math.floor((now.getTime() - ANCHOR.getTime()) / 86400000)
  const currentPeriodIdx = Math.floor(daysSince / 14)
  if (currentPeriodIdx < 1) return null
  const closedIdx = currentPeriodIdx - 1
  const start = new Date(ANCHOR)
  start.setUTCDate(start.getUTCDate() + closedIdx * 14)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 13)
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
}

async function getOrgId(session: { role: string; id: string; org_id?: string | null }): Promise<string | null> {
  if (session.org_id) return session.org_id
  const row = await queryOne<{ org_id: string | null }>('SELECT org_id FROM users WHERE id = $1', [session.id])
  return row?.org_id ?? null
}

async function getPeriodHours(orgId: string, periodStart: string, periodEnd: string) {
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
        AND (s.clock_in_at AT TIME ZONE $4)::date <= $2::date
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
  `, [periodStart, periodEnd, orgId, CST])
}

export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session || session.role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const orgId = await getOrgId(session)
  if (!orgId) return NextResponse.json({ periods: [], myEmployeeHours: [], role: session.role, userId: session.id, orgName: null })

  const orgRow = await queryOne<{ name: string; payroll_launch_date: string | null }>('SELECT name, payroll_launch_date::text FROM organizations WHERE id = $1', [orgId])
  const orgName = orgRow?.name ?? null
  const payrollLaunchDate = orgRow?.payroll_launch_date ?? null

  const biWeeklyPeriods = getBiWeeklyPeriods()

  // Ensure all 4 periods exist
  for (const p of biWeeklyPeriods) {
    await queryOne(`
      INSERT INTO payroll_periods (org_id, period_start, period_end, status)
      VALUES ($1, $2, $3, 'pending_dm')
      ON CONFLICT (org_id, period_start) DO NOTHING
    `, [orgId, p.start, p.end])
  }

  // Fetch the periods from DB (last 4 bi-weekly)
  const startDates = biWeeklyPeriods.map(p => p.start)
  const periods = await query<{
    id: string
    period_start: string
    period_end: string
    status: string
    final_submitted_at: string | null
    final_submitted_by: string | null
    final_submitter_name: string | null
  }>(`
    SELECT
      pp.id,
      pp.period_start::text,
      pp.period_end::text,
      pp.status,
      pp.final_submitted_at::text,
      pp.final_submitted_by,
      u.full_name AS final_submitter_name
    FROM payroll_periods pp
    LEFT JOIN users u ON u.id = pp.final_submitted_by
    WHERE pp.org_id = $1
      AND pp.period_start = ANY($2::date[])
    ORDER BY pp.period_start DESC
  `, [orgId, startDates])

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

  const srApprovals = periodIds.length > 0 ? await query<{
    period_id: string
    dm_id: string
    dm_name: string
    downloaded_at: string | null
    approved_at: string | null
    sr_user_id: string | null
    sr_name: string | null
  }>(`
    SELECT
      psa.period_id,
      psa.dm_id,
      dm.full_name AS dm_name,
      psa.downloaded_at::text,
      psa.approved_at::text,
      psa.sr_user_id,
      sr.full_name AS sr_name
    FROM payroll_sr_approvals psa
    JOIN users dm ON dm.id = psa.dm_id
    LEFT JOIN users sr ON sr.id = psa.sr_user_id
    WHERE psa.period_id = ANY($1)
  `, [periodIds]) : []

  // Only count managers who have at least one active employee assigned
  const dmCount = await queryOne<{ count: string }>(`
    SELECT COUNT(DISTINCT u.id)::text AS count
    FROM users u
    WHERE u.org_id = $1 AND u.role = 'manager' AND u.is_active = TRUE
      AND EXISTS (
        SELECT 1 FROM users e
        WHERE e.manager_id = u.id AND e.role = 'employee' AND e.is_active = TRUE
      )
  `, [orgId])
  const totalDMs = parseInt(dmCount?.count ?? '0')

  // For DMs: get their employees' hours for the last closed period
  let myEmployeeHours: {
    user_id: string
    full_name: string
    regular_hours: number
    ot_hours: number
    total_hours: number
  }[] = []

  let hasEmployees = false

  if (session.role === 'manager') {
    const empCheck = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users WHERE manager_id = $1 AND role = 'employee' AND is_active = TRUE`,
      [session.id]
    )
    hasEmployees = parseInt(empCheck?.count ?? '0') > 0

    const closed = getLastClosedPeriod()
    if (closed) {
      const allHours = await getPeriodHours(orgId, closed.start, closed.end)
      myEmployeeHours = allHours
        .filter(h => h.manager_id === session.id)
        .map(({ user_id, full_name, regular_hours, ot_hours, total_hours }) => ({
          user_id, full_name, regular_hours, ot_hours, total_hours,
        }))
    }
  }

  const enrichedPeriods = periods.map(p => ({
    ...p,
    dmApprovals: dmApprovals.filter(a => a.period_id === p.id),
    srApprovals: srApprovals.filter(a => a.period_id === p.id),
    totalDMs,
  }))

  return NextResponse.json({
    periods: enrichedPeriods,
    myEmployeeHours,
    hasEmployees,
    role: session.role,
    userId: session.id,
    orgName,
    payrollLaunchDate,
  })
}
