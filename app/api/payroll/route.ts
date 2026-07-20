import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'
import { getReceiptViewUrl } from '@/lib/s3'

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

function getWeeklyRanges(count = 4): { start: string; end: string; isCurrent: boolean }[] {
  const now = new Date()
  const cstNow = new Date(now.toLocaleString('en-US', { timeZone: CST }))
  const dayOfWeek = cstNow.getDay()
  const monday = new Date(cstNow)
  monday.setDate(cstNow.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  monday.setHours(0, 0, 0, 0)

  const weeks = []
  for (let i = 0; i < count; i++) {
    const weekStart = new Date(monday)
    weekStart.setDate(monday.getDate() - i * 7)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    weeks.push({
      start: weekStart.toISOString().split('T')[0],
      end: weekEnd.toISOString().split('T')[0],
      isCurrent: i === 0,
    })
  }
  return weeks
}

async function getOrgId(session: { role: string; id: string; org_id?: string | null }): Promise<string | null> {
  // For developer, respect the fmp-dev-org cookie set by the org switcher
  if (session.role === 'developer') {
    const { orgId } = await getOrgFilter(session as Parameters<typeof getOrgFilter>[0])
    if (orgId) return orgId
    // Fall back to developer's own org_id if cookie not set
  }
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
        u.avatar_key,
        DATE_TRUNC('week', s.clock_in_at AT TIME ZONE $4)::date AS week_start,
        SUM(
          EXTRACT(EPOCH FROM (s.clock_out_at - s.clock_in_at)) / 3600.0
          - COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start))) / 3600.0 FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)
        ) AS total_hours
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      WHERE s.clock_out_at IS NOT NULL
        AND (s.clock_in_at AT TIME ZONE $4)::date >= $1::date
        AND (s.clock_in_at AT TIME ZONE $4)::date <= $2::date
        AND u.org_id = $3
        AND u.role = 'employee'
      GROUP BY s.user_id, u.full_name, u.username, u.manager_id, u.avatar_key, week_start
    )
    SELECT
      user_id, full_name, username, manager_id, avatar_key,
      ROUND(SUM(LEAST(total_hours, 40))::numeric, 2)::float AS regular_hours,
      ROUND(SUM(GREATEST(total_hours - 40, 0))::numeric, 2)::float AS ot_hours,
      ROUND(SUM(total_hours)::numeric, 2)::float AS total_hours
    FROM weekly_hours
    GROUP BY user_id, full_name, username, manager_id, avatar_key
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
  let weeklyHours: {
    start: string
    end: string
    isCurrent: boolean
    employees: { user_id: string; full_name: string; regular_hours: number; ot_hours: number; total_hours: number }[]
  }[] = []

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

    // Weekly hours for DMs — current week + 3 previous
    if (hasEmployees) {
      const weeks = getWeeklyRanges(4)
      const rangeStart = weeks[weeks.length - 1].start
      const rangeEnd = weeks[0].end

      const weeklyData = await query<{
        user_id: string; full_name: string; week_start: string; total_hours: number
      }>(`
        SELECT
          s.user_id,
          u.full_name,
          DATE_TRUNC('week', s.clock_in_at AT TIME ZONE $3)::date::text AS week_start,
          ROUND(SUM(
            EXTRACT(EPOCH FROM (COALESCE(s.clock_out_at, NOW()) - s.clock_in_at)) / 3600.0
            - COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start))) / 3600.0
              FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)
          )::numeric, 2)::float AS total_hours
        FROM shifts s
        JOIN users u ON u.id = s.user_id
        WHERE (s.clock_in_at AT TIME ZONE $3)::date >= $1::date
          AND (s.clock_in_at AT TIME ZONE $3)::date <= $2::date
          AND u.manager_id = $4
          AND u.role = 'employee'
          AND u.is_active = TRUE
        GROUP BY s.user_id, u.full_name, week_start
        ORDER BY week_start DESC, u.full_name
      `, [rangeStart, rangeEnd, CST, session.id])

      weeklyHours = weeks.map(week => ({
        ...week,
        employees: weeklyData
          .filter(d => d.week_start === week.start)
          .map(d => ({
            user_id: d.user_id,
            full_name: d.full_name,
            total_hours: Math.round(d.total_hours * 100) / 100,
            regular_hours: Math.round(Math.min(d.total_hours, 40) * 100) / 100,
            ot_hours: Math.round(Math.max(d.total_hours - 40, 0) * 100) / 100,
          })),
      }))
    }
  }

  // For SD/owner/developer: list all DMs with their approval status for the current period
  let allDms: { id: string; full_name: string; employee_count: number }[] = []
  if (session.role !== 'manager') {
    allDms = await query<{ id: string; full_name: string; employee_count: number }>(`
      SELECT u.id, u.full_name,
        (SELECT COUNT(*)::int FROM users e WHERE e.manager_id = u.id AND e.role = 'employee' AND e.is_active = TRUE) AS employee_count
      FROM users u
      WHERE u.org_id = $1 AND u.role = 'manager' AND u.is_active = TRUE
        AND EXISTS (
          SELECT 1 FROM users e
          WHERE e.manager_id = u.id AND e.role = 'employee' AND e.is_active = TRUE
        )
      ORDER BY u.full_name
    `, [orgId])
  }

  // DM hours for SD/owner/developer view
  let dmHours: { user_id: string; full_name: string; regular_hours: number; ot_hours: number; total_hours: number }[] = []
  let dmTimeApprovals: { period_id: string; dm_id: string; approved_by_name: string; approved_at: string }[] = []
  if (session.role !== 'manager' && biWeeklyPeriods.length > 0) {
    // Get DM hours for the most recent closed period
    const closedPeriod = biWeeklyPeriods.find(p => new Date(p.end + 'T23:59:59') < new Date())
    if (closedPeriod) {
      dmHours = await query<{ user_id: string; full_name: string; regular_hours: number; ot_hours: number; total_hours: number }>(`
        WITH weekly_hours AS (
          SELECT
            s.user_id,
            u.full_name,
            DATE_TRUNC('week', s.clock_in_at AT TIME ZONE $4)::date AS week_start,
            SUM(
              EXTRACT(EPOCH FROM (s.clock_out_at - s.clock_in_at)) / 3600.0
              - COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start))) / 3600.0 FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)
            ) AS total_hours
          FROM shifts s
          JOIN users u ON u.id = s.user_id
          WHERE s.clock_out_at IS NOT NULL
            AND (s.clock_in_at AT TIME ZONE $4)::date >= $1::date
            AND (s.clock_in_at AT TIME ZONE $4)::date <= $2::date
            AND u.org_id = $3
            AND u.role = 'manager'
            AND u.is_active = TRUE
          GROUP BY s.user_id, u.full_name, week_start
        )
        SELECT
          user_id, full_name,
          ROUND(SUM(LEAST(total_hours, 40))::numeric, 2)::float AS regular_hours,
          ROUND(SUM(GREATEST(total_hours - 40, 0))::numeric, 2)::float AS ot_hours,
          ROUND(SUM(total_hours)::numeric, 2)::float AS total_hours
        FROM weekly_hours
        GROUP BY user_id, full_name
        ORDER BY full_name
      `, [closedPeriod.start, closedPeriod.end, orgId, CST])
    }

    // Get DM time approval status for all periods
    if (periodIds.length > 0) {
      dmTimeApprovals = await query<{ period_id: string; dm_id: string; approved_by_name: string; approved_at: string }>(`
        SELECT dta.period_id, dta.dm_id, u.full_name AS approved_by_name, dta.approved_at::text
        FROM payroll_dm_time_approvals dta
        JOIN users u ON u.id = dta.approved_by
        WHERE dta.period_id = ANY($1)
      `, [periodIds])
    }
  }

  const enrichedPeriods = periods.map(p => ({
    ...p,
    dmApprovals: dmApprovals.filter(a => a.period_id === p.id),
    srApprovals: srApprovals.filter(a => a.period_id === p.id),
    dmTimeApprovals: dmTimeApprovals.filter(a => a.period_id === p.id),
    totalDMs,
  }))

  return NextResponse.json({
    periods: enrichedPeriods,
    myEmployeeHours,
    weeklyHours,
    hasEmployees,
    role: session.role,
    userId: session.id,
    orgName,
    payrollLaunchDate,
    allDms,
    dmHours,
  })
}
