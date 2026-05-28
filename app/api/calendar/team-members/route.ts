import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'

export const dynamic = 'force-dynamic'

const CAN_VIEW_TEAM = ['ops_manager', 'owner', 'developer', 'sales_director']

// GET /api/calendar/team-members
// Returns list of managers (and sales_directors) available for team calendar view
export async function GET() {
  const session = await getSession()
  if (!session || !CAN_VIEW_TEAM.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = []

  // Return managers and sales_directors who have their own calendars
  // Exclude the current user (they see their own via My Calendar tab)
  const orgClause = appendOrgFilter(orgFilter, params, 'u')

  const members = await query<{ id: string; full_name: string; role: string }>(`
    SELECT id::text, full_name, role
    FROM users u
    WHERE u.role IN ('manager', 'sales_director')
      AND u.is_active = TRUE
      AND u.id != $${params.length + 1}
      ${orgClause}
    ORDER BY u.full_name
  `, [...params, session.id])

  return NextResponse.json({ members })
}
