import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const CST = 'America/Chicago'
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

  const canViewAll = ['ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role)
  if (!canViewAll && !isManager(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  let dmId = searchParams.get('dmId') || (session.role === 'manager' ? session.id : null)

  const period = getCurrentPeriod()
  const from = searchParams.get('from') || period.start
  const to = searchParams.get('to') || period.end

  try {
    // Get all DMs for the selector
    const orgFilter = session.org_id ? `AND org_id = '${(session.org_id as string).replace(/'/g, "''")}'` : ''
    const allDms = canViewAll ? await query<{ id: string; full_name: string }>(`
      SELECT id, full_name FROM users WHERE role = 'manager' AND is_active = TRUE ${orgFilter} ORDER BY full_name
    `) : []

    // Auto-select first DM if none specified
    if (!dmId && allDms.length > 0) dmId = allDms[0].id
    if (!dmId) return NextResponse.json({ error: 'No DMs found' }, { status: 404 })

    // DM info
    const dm = await queryOne<{ id: string; full_name: string }>(`SELECT id, full_name FROM users WHERE id = $1`, [dmId])
    if (!dm) return NextResponse.json({ error: 'DM not found' }, { status: 404 })

    // 1. Coaching Grade
    const coachingGrade = await queryOne<{
      avg_score: number | null; avg_grade: string | null; count: number
      weakest_category: string | null; trend: string
    }>(`
      SELECT
        ROUND(AVG(overall_score)::numeric, 1)::float as avg_score,
        CASE
          WHEN AVG(overall_score) >= 93 THEN 'A' WHEN AVG(overall_score) >= 90 THEN 'A-'
          WHEN AVG(overall_score) >= 87 THEN 'B+' WHEN AVG(overall_score) >= 83 THEN 'B'
          WHEN AVG(overall_score) >= 80 THEN 'B-' WHEN AVG(overall_score) >= 77 THEN 'C+'
          WHEN AVG(overall_score) >= 73 THEN 'C' WHEN AVG(overall_score) >= 70 THEN 'C-'
          WHEN AVG(overall_score) >= 67 THEN 'D+' WHEN AVG(overall_score) >= 60 THEN 'D'
          ELSE 'F' END as avg_grade,
        COUNT(*)::int as count,
        (SELECT cat FROM (
          SELECT 'specificity' as cat, AVG(specificity_score) as s FROM coaching_grades WHERE dm_id = $1 AND graded_at >= $2::date AND graded_at <= ($3::date + 1)
          UNION ALL SELECT 'actionability', AVG(actionability_score) FROM coaching_grades WHERE dm_id = $1 AND graded_at >= $2::date AND graded_at <= ($3::date + 1)
          UNION ALL SELECT 'follow_up', AVG(follow_up_score) FROM coaching_grades WHERE dm_id = $1 AND graded_at >= $2::date AND graded_at <= ($3::date + 1)
          UNION ALL SELECT 'depth', AVG(depth_score) FROM coaching_grades WHERE dm_id = $1 AND graded_at >= $2::date AND graded_at <= ($3::date + 1)
          UNION ALL SELECT 'prior_reference', AVG(prior_reference_score) FROM coaching_grades WHERE dm_id = $1 AND graded_at >= $2::date AND graded_at <= ($3::date + 1)
        ) x WHERE s IS NOT NULL ORDER BY s LIMIT 1) as weakest_category,
        'stable' as trend
      FROM coaching_grades
      WHERE dm_id = $1 AND graded_at >= $2::date AND graded_at <= ($3::date + 1)
    `, [dmId, from, to])

    // 2. Coaching Compliance
    const coachingComp = await queryOne<{ total_visits: number; with_coaching: number; rate: number }>(`
      SELECT
        COUNT(*)::int as total_visits,
        COUNT(*) FILTER (WHERE COALESCE(v.visit_type,'normal') IN ('quick_coaching', 'remote_coaching'))::int as with_coaching,
        CASE WHEN COUNT(*) > 0 THEN
          ROUND((COUNT(*) FILTER (WHERE COALESCE(v.visit_type,'normal') IN ('quick_coaching', 'remote_coaching'))::numeric / COUNT(*)::numeric) * 100)::int
        ELSE 0 END as rate
      FROM dm_store_visits v
      WHERE v.submitted_by_id = $1
        AND v.submitted_at >= $2::date AND v.submitted_at <= ($3::date + 1)
    `, [dmId, from, to])

    // 3. Uniform Compliance (their team)
    const uniformComp = await queryOne<{ total: number; passed: number; failed: number; rate: number }>(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE uc.result = 'pass')::int as passed,
        COUNT(*) FILTER (WHERE uc.result = 'fail')::int as failed,
        CASE WHEN COUNT(*) > 0 THEN
          ROUND((COUNT(*) FILTER (WHERE uc.result = 'pass')::numeric / COUNT(*)::numeric) * 100)::int
        ELSE 0 END as rate
      FROM uniform_checks uc
      JOIN users u ON u.id = uc.user_id
      WHERE u.manager_id = $1
        AND uc.created_at >= $2::date AND uc.created_at <= ($3::date + 1)
        AND uc.result != 'skipped'
    `, [dmId, from, to])

    // 4. Clock-In Integrity
    const integrity = await queryOne<{ total: number; manual: number; edited: number; intervention_rate: number }>(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE s.is_manual = TRUE)::int as manual,
        COUNT(DISTINCT se.shift_id)::int as edited,
        CASE WHEN COUNT(*) > 0 THEN
          ROUND(((COUNT(*) FILTER (WHERE s.is_manual = TRUE) + COUNT(DISTINCT se.shift_id))::numeric / COUNT(*)::numeric) * 100)::int
        ELSE 0 END as intervention_rate
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN shift_edits se ON se.shift_id = s.id
      WHERE u.manager_id = $1 AND u.role = 'employee' AND u.is_active = TRUE
        AND (s.clock_in_at AT TIME ZONE '${CST}')::date >= $2::date
        AND (s.clock_in_at AT TIME ZONE '${CST}')::date <= $3::date
    `, [dmId, from, to])

    // Thresholds
    const amberRow = await queryOne<{ value: unknown }>(`SELECT value FROM dev_config WHERE key = 'integrity_amber_threshold'`).catch(() => null)
    const redRow = await queryOne<{ value: unknown }>(`SELECT value FROM dev_config WHERE key = 'integrity_red_threshold'`).catch(() => null)

    // Overall score — weighted average of the 4 metrics
    const scores = [
      coachingGrade?.avg_score ? Math.min(100, coachingGrade.avg_score) : null,
      coachingComp?.rate ?? null,
      uniformComp?.rate ?? null,
      integrity ? Math.max(0, 100 - (integrity.intervention_rate || 0)) : null,
    ].filter(s => s !== null) as number[]
    const overallScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
    const overallGrade = overallScore === null ? '-' :
      overallScore >= 90 ? 'A' : overallScore >= 80 ? 'B' : overallScore >= 70 ? 'C' : overallScore >= 60 ? 'D' : 'F'

    return NextResponse.json({
      dm, allDms, from, to, currentPeriod: period,
      thresholds: { amber: Number(amberRow?.value) || 20, red: Number(redRow?.value) || 30 },
      coachingGrade: coachingGrade || { avg_score: null, avg_grade: null, count: 0, weakest_category: null, trend: 'new' },
      coachingCompliance: coachingComp || { total_visits: 0, with_coaching: 0, rate: 0 },
      uniformCompliance: uniformComp || { total: 0, passed: 0, failed: 0, rate: 0 },
      integrity: integrity || { total: 0, manual: 0, edited: 0, intervention_rate: 0 },
      overall: { score: overallScore, grade: overallGrade },
    })
  } catch (err) {
    console.error('DM Scorecard error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
