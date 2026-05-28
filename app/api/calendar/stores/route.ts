import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

const CAN_ACCESS = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

// GET /api/calendar/stores?managerId=<uuid>
// Returns active stores assigned to a given manager.
// Managers can only query their own stores; elevated roles can query any manager.
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !CAN_ACCESS.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const managerId = searchParams.get('managerId') ?? session.id

  // Managers can only see their own stores
  if (session.role === 'manager' && managerId !== session.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const stores = await query<{ id: string; address: string }>(`
    SELECT s.id::text, s.address
    FROM dm_store_locations s
    JOIN dm_manager_stores ms ON ms.store_location_id = s.id
    WHERE ms.manager_id = $1
      AND s.active = TRUE
    ORDER BY s.address ASC
  `, [managerId])

  return NextResponse.json({ stores })
}
