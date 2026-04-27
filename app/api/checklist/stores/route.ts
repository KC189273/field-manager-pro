import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

interface StoreRow {
  id: string
  address: string
  dm_id: string | null
  dm_name: string | null
  dm_email: string | null
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let stores: StoreRow[]

  if (session.role === 'employee') {
    // Get stores assigned to this employee's DM
    stores = await query<StoreRow>(`
      SELECT DISTINCT ON (l.id) l.id, l.address,
             m.id AS dm_id, m.full_name AS dm_name, m.email AS dm_email
      FROM dm_store_locations l
      JOIN dm_manager_stores ms ON ms.store_location_id = l.id
      JOIN users emp ON emp.id = $1
      JOIN users m ON m.id = ms.manager_id AND m.id = emp.manager_id
      WHERE l.active = true
      ORDER BY l.id, l.address
    `, [session.id])
  } else if (session.role === 'manager') {
    // Get stores assigned to this DM, DM is themselves
    stores = await query<StoreRow>(`
      SELECT l.id, l.address,
             u.id AS dm_id, u.full_name AS dm_name, u.email AS dm_email
      FROM dm_store_locations l
      JOIN dm_manager_stores ms ON ms.store_location_id = l.id AND ms.manager_id = $1
      JOIN users u ON u.id = $1
      WHERE l.active = true
      ORDER BY l.address
    `, [session.id])
  } else {
    // ops_manager, sales_director, owner, developer — all active stores
    stores = await query<StoreRow>(`
      SELECT DISTINCT ON (l.id) l.id, l.address,
             m.id AS dm_id, m.full_name AS dm_name, m.email AS dm_email
      FROM dm_store_locations l
      LEFT JOIN dm_manager_stores ms ON ms.store_location_id = l.id
      LEFT JOIN users m ON m.id = ms.manager_id
      WHERE l.active = true
      ORDER BY l.id, l.address
    `)
  }

  return NextResponse.json({ stores })
}
