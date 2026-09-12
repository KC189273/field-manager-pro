import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

let ensured = false
async function ensureMyStoresColumns() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE dm_store_locations ADD COLUMN IF NOT EXISTS employee_capacity SMALLINT NOT NULL DEFAULT 1`)
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureMyStoresColumns() } catch {}

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
    // Floaters see all org stores; regular employees see their DM's stores + today's scheduled stores
    const isFloater = await query<{ is_floater: boolean }>(
      `SELECT COALESCE(is_floater, FALSE) as is_floater FROM users WHERE id = $1`, [session.id]
    ).then(r => r[0]?.is_floater).catch(() => false)

    if (isFloater) {
      const orgId = session.org_id
      stores = await query<{ id: string; address: string; employee_capacity: number }>(
        orgId
          ? `SELECT id, address, employee_capacity FROM dm_store_locations WHERE active = true AND org_id = $1 ORDER BY address ASC`
          : `SELECT id, address, employee_capacity FROM dm_store_locations WHERE active = true ORDER BY address ASC`,
        orgId ? [orgId] : []
      )
    } else {
      const todayCST = `(CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date`
      stores = await query<{ id: string; address: string; employee_capacity: number }>(
        `SELECT DISTINCT dsl.id, dsl.address, dsl.employee_capacity
         FROM dm_store_locations dsl
         WHERE dsl.active = true
           AND (
             dsl.id IN (
               SELECT dms.store_location_id
               FROM dm_manager_stores dms
               WHERE dms.manager_id = (SELECT manager_id FROM users WHERE id = $1)
             )
             OR dsl.id IN (
               SELECT ss.store_location_id
               FROM scheduled_shifts ss
               WHERE ss.employee_id = $1
                 AND ss.shift_date = ${todayCST}
             )
           )
         ORDER BY dsl.address ASC`,
        [session.id]
      )
    }
  } else {
    // Higher roles see all active stores
    stores = await query<{ id: string; address: string; employee_capacity: number }>(
      `SELECT id, address, employee_capacity FROM dm_store_locations WHERE active = true ORDER BY address ASC`
    )
  }

  return NextResponse.json({ stores })
}
