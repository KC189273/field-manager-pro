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

  let submissions: unknown[]

  if (session.role === 'manager') {
    // DM sees submissions for stores currently assigned to them
    // Filter by store assignment (not stored dm_id) so reassignments don't cause gaps
    // Date comparison done in CST so late-night submissions don't fall off
    submissions = await query(
      `SELECT id, checklist_type, store_id, store_address,
              submitted_by_name, dm_id, dm_name, submitted_at
       FROM checklist_submissions
       WHERE store_id IN (
         SELECT store_location_id FROM dm_manager_stores WHERE manager_id = $1
       )
       AND DATE(submitted_at AT TIME ZONE 'America/Chicago') = $2::date
       ORDER BY submitted_at DESC`,
      [session.id, date]
    )
  } else {
    const orgFilter = await getOrgFilter(session)
    const params: unknown[] = [date]
    let orgClause = ''
    if (orgFilter.filterByOrg && orgFilter.orgId) {
      params.push(orgFilter.orgId)
      orgClause = ` AND org_id = $${params.length}`
    }
    submissions = await query(
      `SELECT id, checklist_type, store_id, store_address,
              submitted_by_name, dm_id, dm_name, submitted_at
       FROM checklist_submissions
       WHERE DATE(submitted_at AT TIME ZONE 'America/Chicago') = $1::date${orgClause}
       ORDER BY submitted_at DESC`,
      params
    )
  }

  return NextResponse.json({ submissions })
}
