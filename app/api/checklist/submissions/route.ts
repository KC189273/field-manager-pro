import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'

const canViewDashboard = (role: string) =>
  role === 'manager' || role === 'ops_manager' || role === 'owner' ||
  role === 'sales_director' || role === 'developer'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !canViewDashboard(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  const dateStart = `${date}T00:00:00Z`
  const dateEnd = `${date}T23:59:59Z`

  let submissions: unknown[]

  if (session.role === 'manager') {
    // DM sees only submissions for their stores
    submissions = await query(
      `SELECT id, checklist_type, store_id, store_address,
              submitted_by_name, dm_id, dm_name, submitted_at
       FROM checklist_submissions
       WHERE dm_id = $1 AND submitted_at BETWEEN $2 AND $3
       ORDER BY submitted_at DESC`,
      [session.id, dateStart, dateEnd]
    )
  } else {
    const orgFilter = await getOrgFilter(session)
    const params: unknown[] = [dateStart, dateEnd]
    let orgClause = ''
    if (orgFilter.filterByOrg && orgFilter.orgId) {
      params.push(orgFilter.orgId)
      orgClause = ` AND org_id = $${params.length}`
    }
    submissions = await query(
      `SELECT id, checklist_type, store_id, store_address,
              submitted_by_name, dm_id, dm_name, submitted_at
       FROM checklist_submissions
       WHERE submitted_at BETWEEN $1 AND $2${orgClause}
       ORDER BY submitted_at DESC`,
      params
    )
  }

  return NextResponse.json({ submissions })
}
