import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const weekStart = searchParams.get('weekStart')
  if (!weekStart) return NextResponse.json({ error: 'weekStart required' }, { status: 400 })

  const weekEnd = new Date(weekStart + 'T12:00:00')
  weekEnd.setDate(weekEnd.getDate() + 6)
  const weekEndStr = weekEnd.toISOString().split('T')[0]

  // Employee's own shifts
  const shifts = await query<{
    shift_date: string
    start_time: string
    end_time: string
    store_address: string
    role_note: string | null
    break_minutes: number
    is_on_call: boolean
  }>(
    `SELECT ss.shift_date::text, ss.start_time::text, ss.end_time::text,
            sl.address AS store_address, ss.role_note,
            COALESCE(ss.break_minutes, 0) AS break_minutes,
            COALESCE(ss.is_on_call, FALSE) AS is_on_call
     FROM scheduled_shifts ss
     JOIN dm_store_locations sl ON sl.id = ss.store_location_id
     INNER JOIN scheduled_shifts_publish ssp
       ON ssp.store_location_id = ss.store_location_id
       AND ssp.week_start = $2
     WHERE ss.employee_id = $1
       AND ss.shift_date >= $2
       AND ss.shift_date <= $3
     ORDER BY ss.shift_date, ss.start_time`,
    [session.id, weekStart, weekEndStr]
  )

  // For employees: return their DM's store list + optional store schedule lookup
  let stores: { id: string; address: string }[] = []
  let storeShifts: {
    shift_date: string
    start_time: string
    end_time: string
    employee_name: string
    employee_id: string
    role_note: string | null
    is_on_call: boolean
  }[] = []

  if (session.role === 'employee') {
    const user = await queryOne<{ manager_id: string | null }>(
      `SELECT manager_id FROM users WHERE id = $1`, [session.id]
    )
    if (user?.manager_id) {
      stores = await query<{ id: string; address: string }>(
        `SELECT l.id, l.address
         FROM dm_store_locations l
         JOIN dm_manager_stores ms ON ms.store_location_id = l.id
         WHERE ms.manager_id = $1 AND l.active = TRUE
         ORDER BY l.address`,
        [user.manager_id]
      )

      // If a storeId is requested, return that store's published schedule for the week
      const storeId = searchParams.get('storeId')
      if (storeId) {
        // Security: verify this store belongs to the employee's DM
        const owned = stores.find(s => s.id === storeId)
        if (owned) {
          storeShifts = await query<{
            shift_date: string
            start_time: string
            end_time: string
            employee_name: string
            employee_id: string
            role_note: string | null
            is_on_call: boolean
          }>(
            `SELECT ss.shift_date::text, ss.start_time::text, ss.end_time::text,
                    u.full_name AS employee_name, u.id AS employee_id,
                    ss.role_note, COALESCE(ss.is_on_call, FALSE) AS is_on_call
             FROM scheduled_shifts ss
             JOIN users u ON u.id = ss.employee_id
             INNER JOIN scheduled_shifts_publish ssp
               ON ssp.store_location_id = ss.store_location_id
               AND ssp.week_start = $1
             WHERE ss.store_location_id = $2
               AND ss.shift_date >= $1
               AND ss.shift_date <= $3
             ORDER BY ss.shift_date, ss.start_time, u.full_name`,
            [weekStart, storeId, weekEndStr]
          )
        }
      }
    }
  }

  return NextResponse.json({ shifts, stores, storeShifts })
}
