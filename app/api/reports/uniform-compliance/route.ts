import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

const ALLOWED = ['ops_manager', 'owner', 'sales_director', 'developer']

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const days = Math.min(parseInt(searchParams.get('days') || '7') || 7, 90)

    const orgId = session.org_id
    const orgFilter = orgId ? `AND u.org_id = '${(orgId as string).replace(/'/g, "''")}'` : ''

    // Summary stats
    const stats = await query<{
      total: number; passed: number; failed: number; unclear: number; skipped: number
      monthly_cost: number
    }>(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE uc.result = 'pass')::int as passed,
        COUNT(*) FILTER (WHERE uc.result = 'fail')::int as failed,
        COUNT(*) FILTER (WHERE uc.result = 'unclear')::int as unclear,
        COUNT(*) FILTER (WHERE uc.result = 'skipped')::int as skipped,
        COALESCE(SUM(uc.cost_usd) FILTER (WHERE uc.created_at >= DATE_TRUNC('month', NOW())), 0)::float as monthly_cost
      FROM uniform_checks uc
      JOIN users u ON u.id = uc.user_id
      WHERE uc.created_at >= NOW() - INTERVAL '${days} days'
        ${orgFilter}
    `)

    // Recent failures
    const failures = await query<{
      user_name: string; details: string; shirt_ok: boolean | null
      nametag_ok: boolean | null; created_at: string; photo_key: string
    }>(`
      SELECT u.full_name as user_name, uc.details, uc.shirt_ok, uc.nametag_ok,
             uc.created_at::text, uc.photo_key
      FROM uniform_checks uc
      JOIN users u ON u.id = uc.user_id
      WHERE uc.result = 'fail'
        AND uc.created_at >= NOW() - INTERVAL '${days} days'
        ${orgFilter}
      ORDER BY uc.created_at DESC
      LIMIT 50
    `)

    // Repeat offenders
    const offenders = await query<{ user_name: string; fail_count: number }>(`
      SELECT u.full_name as user_name, COUNT(*)::int as fail_count
      FROM uniform_checks uc
      JOIN users u ON u.id = uc.user_id
      WHERE uc.result = 'fail'
        AND uc.created_at >= NOW() - INTERVAL '30 days'
        ${orgFilter}
      GROUP BY u.id, u.full_name
      HAVING COUNT(*) >= 2
      ORDER BY fail_count DESC
    `)

    return NextResponse.json({
      stats: stats[0] || { total: 0, passed: 0, failed: 0, unclear: 0, skipped: 0, monthly_cost: 0 },
      failures,
      offenders,
      days,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
