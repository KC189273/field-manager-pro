import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUsers } from '@/lib/apns'
import { GET as validateSchedule } from '@/app/api/schedule/validate/route'

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

  // Block publishing if any shifts have no employee assigned
  const unassigned = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM scheduled_shifts
     WHERE store_location_id = $1 AND shift_date >= $2 AND shift_date <= ($2::date + INTERVAL '6 days')
       AND employee_id IS NULL`,
    [storeId, weekStart]
  )
  const unassignedCount = parseInt(unassigned?.count ?? '0')
  if (unassignedCount > 0) {
    return NextResponse.json({
      error: `Cannot publish: ${unassignedCount} shift${unassignedCount > 1 ? 's' : ''} still need employees assigned.`,
    }, { status: 400 })
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

  // Run schedule validation and persist any flags found
  try {
    const validateUrl = new URL(`${req.url.replace(/\/staff-schedule\/publish.*/, '')}/schedule/validate`)
    validateUrl.searchParams.set('storeId', storeId)
    validateUrl.searchParams.set('weekStart', weekStart)
    const validateReq = new NextRequest(validateUrl.toString(), { headers: req.headers })
    const validateRes = await validateSchedule(validateReq)
    if (validateRes.ok) {
      const { flags } = await validateRes.json()
      const TYPE_MAP: Record<string, string> = {
        no_opener: 'schedule_no_opener',
        no_closer: 'schedule_no_closer',
        gap: 'schedule_gap',
        overlap: 'schedule_overlap',
        overtime: 'schedule_overtime',
      }
      for (const f of flags) {
        const dbType = TYPE_MAP[f.type]
        if (!dbType) continue
        // Use DM id for store-level flags, employee id for employee-level flags
        const userId = f.employeeId ?? session.id
        const storeCol = f.storeId ? ', store_location_id' : ''
        const storeVal = f.storeId ? `, '${f.storeId}'` : ''
        await query(
          `INSERT INTO flags (user_id, type, date, detail${storeCol})
           VALUES ($1, $2, $3, $4${storeVal})
           ON CONFLICT DO NOTHING`,
          [userId, dbType, f.date, f.detail]
        ).catch(() => {})
      }
    }
  } catch {}

  // Push notification to all employees with shifts for this store/week
  const employees = await query<{ employee_id: string }>(
    `SELECT DISTINCT employee_id FROM scheduled_shifts
     WHERE store_location_id = $1 AND shift_date >= $2 AND shift_date <= ($2::date + INTERVAL '6 days')`,
    [storeId, weekStart]
  )
  const weekDate = new Date(weekStart + 'T12:00:00Z')
  const weekLabel = weekDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  sendPushToUsers(
    employees.map(e => e.employee_id),
    'Schedule Published',
    `Your schedule for the week of ${weekLabel} is now available.`,
    'schedule_published'
  ).catch(() => {})

  return NextResponse.json({ ok: true })
}

// DELETE — unpublish (managers for their own stores; elevated roles for any store)
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  const canUnpublish = session?.role === 'ops_manager' || session?.role === 'owner' ||
    session?.role === 'sales_director' || session?.role === 'developer' || session?.role === 'manager'
  if (!session || !canUnpublish) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { storeId, weekStart } = await req.json()
  if (!storeId || !weekStart) {
    return NextResponse.json({ error: 'storeId and weekStart required' }, { status: 400 })
  }

  // Managers can only unpublish stores assigned to them
  if (session.role === 'manager') {
    const access = await queryOne(
      `SELECT 1 FROM dm_manager_stores WHERE manager_id = $1 AND store_location_id = $2`,
      [session.id, storeId]
    )
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await query(
    `DELETE FROM scheduled_shifts_publish WHERE store_location_id = $1 AND week_start = $2`,
    [storeId, weekStart]
  )

  return NextResponse.json({ ok: true })
}
