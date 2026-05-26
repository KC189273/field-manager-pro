import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const CST = 'America/Chicago'

async function getOrgId(session: { role: string; id: string; org_id?: string | null }): Promise<string | null> {
  if (session.org_id) return session.org_id
  const row = await queryOne<{ org_id: string | null }>('SELECT org_id FROM users WHERE id = $1', [session.id])
  return row?.org_id ?? null
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  const canDownload =
    session &&
    (isOwner(session.role as never) ||
      session.role === 'ops_manager' ||
      session.role === 'sales_director' ||
      session.role === 'developer')

  if (!canDownload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const dmId = searchParams.get('dmId') ?? null

  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

  const orgId = await getOrgId(session!)

  // If dmId provided and role is SD/ops_manager, record download in payroll_sr_approvals
  const canRecordDownload =
    dmId &&
    (session!.role === 'sales_director' || session!.role === 'ops_manager')

  if (canRecordDownload && orgId) {
    // Find the period that covers these dates
    const period = await queryOne<{ id: string }>(`
      SELECT id FROM payroll_periods
      WHERE org_id = $1
        AND period_start <= $2::date
        AND period_end >= $3::date
      LIMIT 1
    `, [orgId, from, to])

    if (period) {
      await queryOne(`
        INSERT INTO payroll_sr_approvals (period_id, dm_id, downloaded_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (period_id, dm_id) DO UPDATE
          SET downloaded_at = COALESCE(payroll_sr_approvals.downloaded_at, NOW())
      `, [period.id, dmId])
    }
  }

  // Build org filter SQL
  const orgFilter = orgId ? `AND u.org_id = '${orgId.replace(/'/g, "''")}'` : ''

  // Build manager filter SQL if dmId provided
  const dmFilter = dmId ? `AND u.manager_id = '${dmId.replace(/'/g, "''")}'` : ''

  const rows = await query<{
    user_id: string
    last_name: string
    first_name: string
    username: string
    org_name: string | null
    regular_hours: number
    ot_hours: number
    total_hours: number
  }>(`
    WITH weekly_hours AS (
      SELECT
        s.user_id,
        u.full_name,
        u.username,
        u.org_id,
        u.manager_id,
        o.name AS org_name,
        DATE_TRUNC('week', s.clock_in_at AT TIME ZONE $3)::date AS week_start,
        SUM(
          EXTRACT(EPOCH FROM (s.clock_out_at - s.clock_in_at)) / 3600.0
          - COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start))) / 3600.0 FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)
        ) AS total_hours
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN organizations o ON o.id = u.org_id
      WHERE s.clock_out_at IS NOT NULL
        AND (s.clock_in_at AT TIME ZONE $3)::date >= $1::date
        AND (s.clock_in_at AT TIME ZONE $3)::date <= $2::date
        AND u.role = 'employee'
        ${orgFilter}
        ${dmFilter}
      GROUP BY s.user_id, u.full_name, u.username, u.org_id, u.manager_id, o.name, week_start
    )
    SELECT
      user_id,
      TRIM(SPLIT_PART(full_name, ' ', 2)) AS last_name,
      TRIM(SPLIT_PART(full_name, ' ', 1)) AS first_name,
      username,
      org_name,
      ROUND(SUM(LEAST(total_hours, 40))::numeric, 2)::float AS regular_hours,
      ROUND(SUM(GREATEST(total_hours - 40, 0))::numeric, 2)::float AS ot_hours,
      ROUND(SUM(total_hours)::numeric, 2)::float AS total_hours
    FROM weekly_hours
    GROUP BY user_id, full_name, username, org_name
    ORDER BY last_name, first_name
  `, [from, to, CST])

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No data for selected period' }, { status: 404 })
  }

  // ADP batch ID = 6-digit YYMMDD of today's processing date
  const todayAdp = new Date()
  const batchId = [
    String(todayAdp.getUTCFullYear()).slice(2),
    String(todayAdp.getUTCMonth() + 1).padStart(2, '0'),
    String(todayAdp.getUTCDate()).padStart(2, '0'),
  ].join('')

  // ADP date format: MM/DD/YYYY
  function toAdpDate(iso: string): string {
    const [y, m, d] = iso.split('-')
    return `${m}/${d}/${y}`
  }

  // ADP Workforce Now import format — headers must NOT be quoted
  const headers = [
    'Co Code', 'Batch ID', 'File #', 'First Name', 'Last Name',
    'Pay Period Begin Date', 'Pay Period End Date',
    'Reg Hours', 'O/T Hours',
  ]

  const csvRows = [
    headers.join(','),
    ...rows.map(r => [
      '',                              // Co Code — filled by ADP admin (org-specific)
      batchId,                         // YYMMDD processing date
      `"${r.username}"`,               // File # — ADP employee ID / badge number
      `"${r.first_name}"`,
      `"${r.last_name}"`,
      toAdpDate(from),                 // MM/DD/YYYY
      toAdpDate(to),                   // MM/DD/YYYY
      r.regular_hours.toFixed(2),
      r.ot_hours.toFixed(2),
    ].join(',')),
  ]

  const csv = csvRows.join('\r\n')
  const filename = `ADP_Payroll_${from}_to_${to}.csv`

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
