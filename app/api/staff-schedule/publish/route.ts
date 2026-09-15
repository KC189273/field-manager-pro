import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser, sendPushToUsers } from '@/lib/apns'
import { logScheduleChange } from '@/lib/schedule-audit'
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

  const storeRow = await queryOne<{ address: string }>(`SELECT address FROM dm_store_locations WHERE id = $1`, [storeId])
  logScheduleChange({
    action: 'publish', performedBy: session.id, performedByName: session.fullName,
    storeLocationId: storeId, storeAddress: storeRow?.address,
    metadata: { week_start: weekStart },
  })

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
        const userId = f.employeeId ?? session.id
        // Skip if an unresolved flag of this type already exists for this user+date
        const existing = await queryOne<{ id: string }>(
          `SELECT id FROM flags WHERE user_id = $1 AND type = $2 AND date = $3 AND resolved = FALSE LIMIT 1`,
          [userId, dbType, f.date]
        ).catch(() => null)
        if (existing) continue
        const storeCol = f.storeId ? ', store_location_id' : ''
        const storeVal = f.storeId ? `, '${f.storeId}'` : ''
        await query(
          `INSERT INTO flags (user_id, type, date, detail${storeCol})
           VALUES ($1, $2, $3, $4${storeVal})`,
          [userId, dbType, f.date, f.detail]
        ).catch(() => {})
      }
    }
  } catch {}

  // Push notification to each employee with their specific shifts
  const empShifts = await query<{ employee_id: string; shift_date: string; start_time: string; end_time: string }>(
    `SELECT employee_id, shift_date::text, start_time::text, end_time::text
     FROM scheduled_shifts
     WHERE store_location_id = $1 AND shift_date >= $2 AND shift_date <= ($2::date + INTERVAL '6 days')
       AND employee_id IS NOT NULL
     ORDER BY employee_id, shift_date`,
    [storeId, weekStart]
  )
  const weekDate = new Date(weekStart + 'T12:00:00Z')
  const weekLabel = weekDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const storeName = storeRow?.address?.split(',')[0] || 'your store'

  // Group shifts by employee
  const byEmployee = new Map<string, string[]>()
  for (const s of empShifts) {
    if (!byEmployee.has(s.employee_id)) byEmployee.set(s.employee_id, [])
    const dayName = new Date(s.shift_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
    const startH = parseInt(s.start_time); const startM = s.start_time.slice(3, 5)
    const fmtStart = `${startH % 12 || 12}:${startM}${startH >= 12 ? 'PM' : 'AM'}`
    byEmployee.get(s.employee_id)!.push(`${dayName} ${fmtStart}`)
  }

  for (const [empId, days] of byEmployee) {
    sendPushToUser(
      empId,
      `Schedule — ${storeName}`,
      `Week of ${weekLabel}: ${days.join(', ')}. Open My Schedule to view details.`,
      'schedule_published'
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}

// DELETE — unpublish (managers for their own stores; elevated roles for any store)
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  const canUnpublish = session?.role === 'ops_field_leader' || session?.role === 'ops_manager' || session?.role === 'owner' ||
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
