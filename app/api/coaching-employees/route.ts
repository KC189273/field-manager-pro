import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || (!isManager(session.role) && session.role !== 'developer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Stretch DMs see their DM's employees
  let managerId = session.id
  if ((session.role as string) === 'employee') {
    const emp = await queryOne<{ manager_id: string | null; is_stretch_dm: boolean }>(
      `SELECT manager_id, COALESCE(is_stretch_dm, FALSE) as is_stretch_dm FROM users WHERE id = $1`, [session.id]
    )
    if (!emp?.is_stretch_dm || !emp.manager_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    managerId = emp.manager_id
  }

  const { searchParams } = new URL(req.url)
  const employeeId = searchParams.get('employeeId')

  // If employeeId provided, return last coaching for that employee
  if (employeeId) {
    const lastCoaching = await queryOne<{
      graded_at: string; overall_grade: string; overall_score: number
      summary: string | null; improvement_tips: string[] | null
      specificity_feedback: string | null; actionability_feedback: string | null
      follow_up_feedback: string | null; depth_feedback: string | null
      prior_reference_feedback: string | null; store_address: string | null
    }>(`
      SELECT graded_at::text, overall_grade, overall_score, summary,
             improvement_tips, specificity_feedback, actionability_feedback,
             follow_up_feedback, depth_feedback, prior_reference_feedback,
             store_address
      FROM coaching_grades
      WHERE employee_coached = (SELECT full_name FROM users WHERE id = $1)
      ORDER BY graded_at DESC LIMIT 1
    `, [employeeId])

    return NextResponse.json({ lastCoaching })
  }

  // Return employee list
  const orgId = session.org_id
  const isLeadership = ['ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role)

  let employees: Array<{ id: string; full_name: string; store_address: string | null }>

  if (isLeadership) {
    // Leadership sees all employees alphabetically
    const orgFilter = orgId ? `AND u.org_id = '${(orgId as string).replace(/'/g, "''")}'` : ''
    employees = await query(`
      SELECT u.id, u.full_name,
        (SELECT dsl.address FROM dm_manager_stores dms
         JOIN dm_store_locations dsl ON dsl.id = dms.store_location_id
         WHERE dms.manager_id = u.manager_id LIMIT 1) as store_address
      FROM users u
      WHERE u.role = 'employee' AND u.is_active = TRUE ${orgFilter}
      ORDER BY u.full_name
    `)
  } else {
    // DMs see their direct reports
    employees = await query(`
      SELECT u.id, u.full_name,
        (SELECT dsl.address FROM dm_manager_stores dms
         JOIN dm_store_locations dsl ON dsl.id = dms.store_location_id
         WHERE dms.manager_id = $1 LIMIT 1) as store_address
      FROM users u
      WHERE u.manager_id = $1 AND u.role = 'employee' AND u.is_active = TRUE
      ORDER BY u.full_name
    `, [managerId])
  }

  return NextResponse.json({ employees })
}
