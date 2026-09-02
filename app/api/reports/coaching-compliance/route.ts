import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

const ALLOWED = ['ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer']

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const days = Math.min(parseInt(searchParams.get('range') || '7') || 7, 90)

  try {
  const orgId = session.org_id
  const orgFilter = orgId ? `AND u.org_id = '${(orgId as string).replace(/'/g, "''")}'` : ''

  const dmStats = await query<{
    dm_id: string; dm_name: string
    total_visits: number; visits_with_coaching: number; visits_without_coaching: number
    compliance_rate: number
  }>(`
    SELECT
      u.id as dm_id, u.full_name as dm_name,
      COUNT(*)::int as total_visits,
      COUNT(*) FILTER (WHERE COALESCE(v.visit_type,'normal') IN ('quick_coaching', 'remote_coaching'))::int as visits_with_coaching,
      COUNT(*) FILTER (WHERE COALESCE(v.visit_type,'normal') NOT IN ('quick_coaching', 'remote_coaching'))::int as visits_without_coaching,
      CASE WHEN COUNT(*) > 0 THEN
        ROUND((COUNT(*) FILTER (WHERE COALESCE(v.visit_type,'normal') IN ('quick_coaching', 'remote_coaching'))::numeric / COUNT(*)::numeric) * 100)::int
      ELSE 0 END as compliance_rate
    FROM dm_store_visits v
    JOIN users u ON u.id = v.submitted_by_id
    WHERE v.submitted_at >= NOW() - INTERVAL '${days} days'
      AND u.role = 'manager'
      ${orgFilter}
    GROUP BY u.id, u.full_name
    ORDER BY compliance_rate ASC, u.full_name
  `)

  const totals = {
    totalVisits: dmStats.reduce((s, d) => s + d.total_visits, 0),
    withCoaching: dmStats.reduce((s, d) => s + d.visits_with_coaching, 0),
    withoutCoaching: dmStats.reduce((s, d) => s + d.visits_without_coaching, 0),
    overallRate: 0 as number,
  }
  totals.overallRate = totals.totalVisits > 0 ? Math.round((totals.withCoaching / totals.totalVisits) * 100) : 0

  const todayMissing = await query<{
    dm_name: string; store_address: string; submitted_at: string
  }>(`
    SELECT u.full_name as dm_name, v.store_address, v.submitted_at::text
    FROM dm_store_visits v
    JOIN users u ON u.id = v.submitted_by_id
    WHERE (v.submitted_at AT TIME ZONE 'America/Chicago')::date = CURRENT_DATE
      AND COALESCE(v.visit_type, 'normal') NOT IN ('quick_coaching', 'remote_coaching')
      AND u.role = 'manager'
      ${orgFilter}
    ORDER BY v.submitted_at DESC
  `)

  return NextResponse.json({ dmStats, totals, todayMissing, days })
  } catch (err) {
    console.error('Coaching compliance error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
