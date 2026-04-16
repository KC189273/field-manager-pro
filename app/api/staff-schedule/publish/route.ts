import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

// POST — publish a (store, week) pair
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { storeId, weekStart } = await req.json()
  if (!storeId || !weekStart) {
    return NextResponse.json({ error: 'storeId and weekStart required' }, { status: 400 })
  }

  // Managers must own the store
  if (session.role === 'manager') {
    const access = await queryOne(
      `SELECT 1 FROM dm_manager_stores WHERE manager_id = $1 AND store_location_id = $2`,
      [session.id, storeId]
    )
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Must have at least one shift to publish
  const count = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM scheduled_shifts
     WHERE store_location_id = $1 AND shift_date >= $2 AND shift_date <= ($2::date + INTERVAL '6 days')`,
    [storeId, weekStart]
  )
  if (parseInt(count?.count ?? '0') === 0) {
    return NextResponse.json({ error: 'No shifts to publish' }, { status: 400 })
  }

  await query(
    `INSERT INTO scheduled_shifts_publish (store_location_id, week_start, published_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (store_location_id, week_start) DO NOTHING`,
    [storeId, weekStart, session.id]
  )

  return NextResponse.json({ ok: true })
}

// DELETE — unpublish (ops_manager, owner, developer only)
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  const canUnpublish = session?.role === 'ops_manager' || session?.role === 'owner' || session?.role === 'developer'
  if (!session || !canUnpublish) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { storeId, weekStart } = await req.json()
  if (!storeId || !weekStart) {
    return NextResponse.json({ error: 'storeId and weekStart required' }, { status: 400 })
  }

  await query(
    `DELETE FROM scheduled_shifts_publish WHERE store_location_id = $1 AND week_start = $2`,
    [storeId, weekStart]
  )

  return NextResponse.json({ ok: true })
}
