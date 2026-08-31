import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner, type Role } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'
import { scoreToGrade } from '@/lib/coaching-grader'

const canViewAll = (role: Role) => role === 'ops_field_leader' || role === 'ops_manager' || isOwner(role) || role === 'developer'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['manager', 'ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const month = searchParams.get('month') // YYYY-MM
  const dmId = searchParams.get('dmId')

  const orgFilter = await getOrgFilter(session)

  // ── Single DM detail view ──
  if (dmId) {
    const targetDm = canViewAll(session.role) ? dmId : session.id
    const params: unknown[] = [targetDm]
    let dateFilter = ''
    if (month) {
      dateFilter = ` AND cg.graded_at >= $2::date AND cg.graded_at < ($2::date + INTERVAL '1 month')`
      params.push(`${month}-01`)
    }

    const grades = await query<{
      id: string; visit_id: string; graded_at: string; store_address: string
      employee_coached: string | null; overall_grade: string; overall_score: number
      specificity_grade: string; specificity_score: number; specificity_feedback: string
      actionability_grade: string; actionability_score: number; actionability_feedback: string
      follow_up_grade: string; follow_up_score: number; follow_up_feedback: string
      depth_grade: string; depth_score: number; depth_feedback: string
      prior_reference_grade: string; prior_reference_score: number; prior_reference_feedback: string
      summary: string; improvement_tips: string
    }>(`
      SELECT cg.id, cg.visit_id, cg.graded_at::text, cg.store_address,
             cg.employee_coached, cg.overall_grade, cg.overall_score,
             cg.specificity_grade, cg.specificity_score, cg.specificity_feedback,
             cg.actionability_grade, cg.actionability_score, cg.actionability_feedback,
             cg.follow_up_grade, cg.follow_up_score, cg.follow_up_feedback,
             cg.depth_grade, cg.depth_score, cg.depth_feedback,
             cg.prior_reference_grade, cg.prior_reference_score, cg.prior_reference_feedback,
             cg.summary, cg.improvement_tips::text
      FROM coaching_grades cg
      WHERE cg.dm_id = $1 ${dateFilter}
      ORDER BY cg.graded_at DESC
    `, params)

    // Monthly average
    const avg = await query<{ month: string; avg_score: number; count: number }>(`
      SELECT TO_CHAR(graded_at, 'YYYY-MM') as month,
             ROUND(AVG(overall_score))::int as avg_score,
             COUNT(*)::int as count
      FROM coaching_grades WHERE dm_id = $1
      GROUP BY TO_CHAR(graded_at, 'YYYY-MM')
      ORDER BY month DESC LIMIT 6
    `, [targetDm])

    // 3-month rolling trend
    const trend = avg.length >= 2
      ? avg[0].avg_score > avg[1].avg_score ? 'improving'
        : avg[0].avg_score < avg[1].avg_score ? 'declining'
        : 'consistent'
      : 'new'

    return NextResponse.json({
      grades,
      monthlyAvg: avg.map(a => ({ ...a, grade: scoreToGrade(a.avg_score) })),
      trend,
    })
  }

  // ── Dashboard rollup: all DMs ──
  const params: unknown[] = []
  let orgClause = ''
  if (orgFilter.filterByOrg && orgFilter.orgId) {
    params.push(orgFilter.orgId)
    orgClause = ` AND cg.org_id = $${params.length}`
  }

  // If DM, only show own data
  if (session.role === 'manager') {
    params.push(session.id)
    orgClause += ` AND cg.dm_id = $${params.length}`
  }

  // Current month grades per DM
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  params.push(`${currentMonth}-01`)
  const monthIdx = params.length

  const dmRollup = await query<{
    dm_id: string; dm_name: string; avg_score: number; count: number
    prev_avg_score: number | null
  }>(`
    SELECT cg.dm_id, cg.dm_name,
           ROUND(AVG(cg.overall_score) FILTER (WHERE cg.graded_at >= $${monthIdx}::date AND cg.graded_at < $${monthIdx}::date + INTERVAL '1 month'))::int as avg_score,
           COUNT(*) FILTER (WHERE cg.graded_at >= $${monthIdx}::date AND cg.graded_at < $${monthIdx}::date + INTERVAL '1 month')::int as count,
           ROUND(AVG(cg.overall_score) FILTER (WHERE cg.graded_at >= $${monthIdx}::date - INTERVAL '1 month' AND cg.graded_at < $${monthIdx}::date))::int as prev_avg_score
    FROM coaching_grades cg
    WHERE 1=1 ${orgClause}
    GROUP BY cg.dm_id, cg.dm_name
    ORDER BY avg_score ASC NULLS LAST
  `, params)

  // Available months
  const months = await query<{ month: string }>(`
    SELECT DISTINCT TO_CHAR(graded_at, 'YYYY-MM') as month
    FROM coaching_grades
    WHERE 1=1 ${orgClause.replace(new RegExp(`\\$${monthIdx}`, 'g'), `'${currentMonth}-01'`)}
    ORDER BY month DESC
  `, params.slice(0, monthIdx - 1))

  return NextResponse.json({
    currentMonth,
    dmRollup: dmRollup.map(d => ({
      ...d,
      grade: d.avg_score ? scoreToGrade(d.avg_score) : null,
      prev_grade: d.prev_avg_score ? scoreToGrade(d.prev_avg_score) : null,
      trend: d.avg_score && d.prev_avg_score
        ? d.avg_score > d.prev_avg_score ? 'improving'
          : d.avg_score < d.prev_avg_score ? 'declining'
          : 'consistent'
        : 'new',
    })),
    availableMonths: months.map(m => m.month),
  })
}
