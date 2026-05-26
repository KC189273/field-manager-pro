import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query } from '@/lib/db'

const canAssign = (role: string) =>
  role === 'manager' || role === 'ops_manager' || isOwner(role as never) || role === 'developer'

// GET /api/tasks/store-employees
// No params → returns stores accessible to the current user
// ?storeId=X&date=YYYY-MM-DD → returns employees scheduled at that store on that date
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !canAssign(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const storeId = searchParams.get('storeId')
  const date = searchParams.get('date')

  // No storeId → return list of accessible stores
  if (!storeId) {
    let stores: { id: string; address: string }[]

    if (session.role === 'developer') {
      stores = await query<{ id: string; address: string }>(
        `SELECT id, address FROM dm_store_locations WHERE active = TRUE ORDER BY address`
      )
    } else if (session.role === 'manager') {
      stores = await query<{ id: string; address: string }>(
        `SELECT sl.id, sl.address
         FROM dm_store_locations sl
         JOIN dm_manager_stores ms ON ms.store_location_id = sl.id
         WHERE ms.manager_id = $1 AND sl.active = TRUE
         ORDER BY sl.address`,
        [session.id]
      )
    } else {
      // ops_manager, owner, sales_director — all stores in their org
      stores = await query<{ id: string; address: string }>(
        `SELECT DISTINCT sl.id, sl.address
         FROM dm_store_locations sl
         JOIN dm_manager_stores ms ON ms.store_location_id = sl.id
         JOIN users u ON u.id = ms.manager_id
         WHERE u.org_id = (SELECT org_id FROM users WHERE id = $1)
           AND sl.active = TRUE
         ORDER BY sl.address`,
        [session.id]
      )
    }

    return NextResponse.json({ stores })
  }

  if (!date) {
    return NextResponse.json({ error: 'date required when storeId is provided' }, { status: 400 })
  }

  // Verify DMs only query their own stores
  if (session.role === 'manager') {
    const access = await query(
      `SELECT 1 FROM dm_manager_stores WHERE manager_id = $1 AND store_location_id = $2`,
      [session.id, storeId]
    )
    if (!access.length) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const employees = await query<{ id: string; full_name: string }>(
    `SELECT DISTINCT u.id, u.full_name
     FROM scheduled_shifts ss
     JOIN users u ON u.id = ss.employee_id
     WHERE ss.store_location_id = $1
       AND ss.shift_date = $2
       AND ss.employee_id IS NOT NULL
       AND u.is_active = TRUE
     ORDER BY u.full_name`,
    [storeId, date]
  )

  return NextResponse.json({ employees })
}
