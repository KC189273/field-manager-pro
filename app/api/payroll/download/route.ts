import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'

const CST = 'America/Chicago'

async function getOrgId(session: { role: string; id: string; org_id?: string | null }): Promise<string | null> {
  if (session.org_id) return session.org_id
  const row = await queryOne<{ org_id: string | null }>('SELECT org_id FROM users WHERE id = $1', [session.id])
  return row?.org_id ?? null
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  const canDownload = session && (
    isOwner(session.role as never) ||
    session.role === 'ops_manager' ||
    session.role === 'sales_director' ||
    session.role === 'developer'
  )
  if (!canDownload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

  const orgId = await getOrgId(session!)

  // For developer with no org filter, allow all orgs
  const orgFilter = orgId ? `AND u.org_id = '${orgId}'` : ''

  const toExclusive = new Date(to)
  toExclusive.setDate(toExclusive.getDate() + 1)
  const toStr = toExclusive.toISOString().split('T')[0]

  // Calculate weekly hours per employee, then aggregate per period
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
        o.name AS org_name,
        DATE_TRUNC('week', s.clock_in_at AT TIME ZONE $3)::date AS week_start,
        SUM(EXTRACT(EPOCH FROM (s.clock_out_at - s.clock_in_at)) / 3600.0) AS total_hours
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN organizations o ON o.id = u.org_id
      WHERE s.clock_out_at IS NOT NULL
        AND (s.clock_in_at AT TIME ZONE $3)::date >= $1::date
        AND (s.clock_in_at AT TIME ZONE $3)::date < $2::date
        AND u.role = 'employee'
        ${orgFilter}
      GROUP BY s.user_id, u.full_name, u.username, u.org_id, o.name, week_start
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
  `, [from, toStr, CST])

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No data for selected period' }, { status: 404 })
  }

  // Build ADP-compatible CSV
  const batchId = `FMP-${from.replace(/-/g, '')}-${to.replace(/-/g, '')}`

  const headers = [
    'Co Code', 'Batch ID', 'File #', 'First Name', 'Last Name',
    'Pay Period Begin Date', 'Pay Period End Date',
    'Regular Hours', 'Overtime Hours', 'Total Hours'
  ]

  const csvRows = [
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(r => [
      '""',                           // Co Code — owner fills in
      `"${batchId}"`,
      `"${r.username}"`,              // File # — ADP employee ID placeholder
      `"${r.first_name}"`,
      `"${r.last_name}"`,
      `"${from}"`,
      `"${to}"`,
      `"${r.regular_hours.toFixed(2)}"`,
      `"${r.ot_hours.toFixed(2)}"`,
      `"${r.total_hours.toFixed(2)}"`,
    ].join(','))
  ]

  const csv = csvRows.join('\r\n')
  const filename = `FMP_ADP_Payroll_${from}_to_${to}.csv`

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
