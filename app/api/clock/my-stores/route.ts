import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Ensure employee_capacity column exists
  try {
    await query(`ALTER TABLE dm_store_locations ADD COLUMN IF NOT EXISTS employee_capacity SMALLINT NOT NULL DEFAULT 1`)
  } catch { /* already exists */ }

  let stores: { id: string; address: string; employee_capacity: number }[]

  if (session.role === 'manager') {
    // Manager sees their own assigned stores
    stores = await query<{ id: string; address: string; employee_capacity: number }>(
      `SELECT dsl.id, dsl.address, dsl.employee_capacity
       FROM dm_store_locations dsl
       JOIN dm_manager_stores dms ON dms.store_location_id = dsl.id
       WHERE dms.manager_id = $1 AND dsl.active = true
       ORDER BY dsl.address ASC`,
      [session.id]
    )
  } else if (session.role === 'employee') {
    // Employee sees stores assigned to their DM
    stores = await query<{ id: string; address: string; employee_capacity: number }>(
      `SELECT dsl.id, dsl.address, dsl.employee_capacity
       FROM dm_store_locations dsl
       JOIN dm_manager_stores dms ON dms.store_location_id = dsl.id
       WHERE dms.manager_id = (SELECT manager_id FROM users WHERE id = $1)
         AND dsl.active = true
       ORDER BY dsl.address ASC`,
      [session.id]
    )
  } else {
    // Higher roles see all active stores
    stores = await query<{ id: string; address: string; employee_capacity: number }>(
      `SELECT id, address, employee_capacity FROM dm_store_locations WHERE active = true ORDER BY address ASC`
    )
  }

  return NextResponse.json({ stores })
}
