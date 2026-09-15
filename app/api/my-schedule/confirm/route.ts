import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

// POST — employee confirms they've seen their schedule
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { weekStart, storeLocationId } = await req.json()
  if (!weekStart) return NextResponse.json({ error: 'weekStart required' }, { status: 400 })

  // Get store from their shifts if not provided
  let storeId = storeLocationId
  if (!storeId) {
    const shift = await queryOne<{ store_location_id: string }>(`
      SELECT DISTINCT store_location_id FROM scheduled_shifts
      WHERE employee_id = $1 AND shift_date >= $2 AND shift_date <= ($2::date + 6)
      LIMIT 1
    `, [session.id, weekStart])
    storeId = shift?.store_location_id
  }

  if (!storeId) return NextResponse.json({ error: 'No shifts found to confirm' }, { status: 400 })

  await query(`
    INSERT INTO schedule_confirmations (user_id, store_location_id, week_start)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, store_location_id, week_start) DO NOTHING
  `, [session.id, storeId, weekStart])

  return NextResponse.json({ ok: true })
}
