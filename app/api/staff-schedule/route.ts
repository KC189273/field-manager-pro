import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

interface ShiftRow {
  id: string
  store_location_id: string
  store_address: string
  employee_id: string
  employee_name: string
  shift_date: string
  start_time: string
  end_time: string
  role_note: string | null
}

// GET /api/staff-schedule?weekStart=YYYY-MM-DD&storeId=UUID
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const weekStart = searchParams.get('weekStart')
  const storeId = searchParams.get('storeId')

  if (!weekStart) return NextResponse.json({ error: 'weekStart required' }, { status: 400 })

  // Derive Sunday from weekStart for range query
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const weekEndStr = weekEnd.toISOString().split('T')[0]

  // Employees: read-only, own published shifts only
  if (session.role === 'employee') {
    const shifts = await query<ShiftRow>(`
      SELECT
        ss.id, ss.store_location_id, sl.address AS store_address,
        ss.employee_id, u.full_name AS employee_name,
        ss.shift_date::text AS shift_date,
        ss.start_time::text AS start_time,
        ss.end_time::text   AS end_time,
        ss.role_note
      FROM scheduled_shifts ss
      JOIN users u ON u.id = ss.employee_id
      JOIN dm_store_locations sl ON sl.id = ss.store_location_id
      INNER JOIN scheduled_shifts_publish ssp
        ON ssp.store_location_id = ss.store_location_id
        AND ssp.week_start = $1
      WHERE ss.employee_id = $2
        AND ss.shift_date >= $1
        AND ss.shift_date <= $3
      ORDER BY ss.shift_date, ss.start_time
    `, [weekStart, session.id, weekEndStr])

    return NextResponse.json({ shifts, isPublished: true })
  }

  // Managers+ require a storeId
  if (!storeId) return NextResponse.json({ error: 'storeId required' }, { status: 400 })

  // Verify store access for managers
  if (session.role === 'manager') {
    const access = await queryOne(
      `SELECT 1 FROM dm_manager_stores WHERE manager_id = $1 AND store_location_id = $2`,
      [session.id, storeId]
    )
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const shifts = await query<ShiftRow>(`
    SELECT
      ss.id, ss.store_location_id, sl.address AS store_address,
      ss.employee_id, u.full_name AS employee_name,
      ss.shift_date::text AS shift_date,
      ss.start_time::text AS start_time,
      ss.end_time::text   AS end_time,
      ss.role_note
    FROM scheduled_shifts ss
    JOIN users u ON u.id = ss.employee_id
    JOIN dm_store_locations sl ON sl.id = ss.store_location_id
    WHERE ss.store_location_id = $1
      AND ss.shift_date >= $2
      AND ss.shift_date <= $3
    ORDER BY ss.shift_date, ss.start_time, u.full_name
  `, [storeId, weekStart, weekEndStr])

  const pubRow = await queryOne(
    `SELECT 1 FROM scheduled_shifts_publish WHERE store_location_id = $1 AND week_start = $2`,
    [storeId, weekStart]
  )

  return NextResponse.json({ shifts, isPublished: !!pubRow })
}

// POST /api/staff-schedule — create shift
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { storeId, employeeId, shiftDate, startTime, endTime, roleNote } = await req.json()

  if (!storeId || !employeeId || !shiftDate || !startTime || !endTime) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (startTime >= endTime) {
    return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 })
  }

  // Verify store access for managers
  if (session.role === 'manager') {
    const access = await queryOne(
      `SELECT 1 FROM dm_manager_stores WHERE manager_id = $1 AND store_location_id = $2`,
      [session.id, storeId]
    )
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Managers cannot edit published weeks
    const weekStart = getWeekMonday(shiftDate)
    const pub = await queryOne(
      `SELECT 1 FROM scheduled_shifts_publish WHERE store_location_id = $1 AND week_start = $2`,
      [storeId, weekStart]
    )
    if (pub) return NextResponse.json({ error: 'Cannot add shifts to a published week' }, { status: 400 })
  }

  const store = await queryOne<{ org_id: string | null }>(
    `SELECT org_id FROM dm_store_locations WHERE id = $1`,
    [storeId]
  )

  const result = await queryOne<{ id: string }>(
    `INSERT INTO scheduled_shifts
       (org_id, store_location_id, employee_id, shift_date, start_time, end_time, role_note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [store?.org_id ?? null, storeId, employeeId, shiftDate, startTime, endTime, roleNote || null, session.id]
  )

  return NextResponse.json({ ok: true, id: result?.id })
}

// PATCH /api/staff-schedule — update shift
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { shiftId, employeeId, shiftDate, startTime, endTime, roleNote } = await req.json()
  if (!shiftId) return NextResponse.json({ error: 'shiftId required' }, { status: 400 })

  if (startTime && endTime && startTime >= endTime) {
    return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 })
  }

  // For managers: verify they own the store and week is not published
  if (session.role === 'manager') {
    const shift = await queryOne<{ store_location_id: string; shift_date: string }>(
      `SELECT store_location_id, shift_date::text FROM scheduled_shifts WHERE id = $1`,
      [shiftId]
    )
    if (!shift) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const access = await queryOne(
      `SELECT 1 FROM dm_manager_stores WHERE manager_id = $1 AND store_location_id = $2`,
      [session.id, shift.store_location_id]
    )
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const weekStart = getWeekMonday(shift.shift_date)
    const pub = await queryOne(
      `SELECT 1 FROM scheduled_shifts_publish WHERE store_location_id = $1 AND week_start = $2`,
      [shift.store_location_id, weekStart]
    )
    if (pub) return NextResponse.json({ error: 'Cannot edit shifts in a published week' }, { status: 400 })
  }

  await query(
    `UPDATE scheduled_shifts
     SET employee_id = COALESCE($1, employee_id),
         shift_date  = COALESCE($2, shift_date),
         start_time  = COALESCE($3, start_time),
         end_time    = COALESCE($4, end_time),
         role_note   = $5,
         updated_at  = NOW()
     WHERE id = $6`,
    [employeeId ?? null, shiftDate ?? null, startTime ?? null, endTime ?? null, roleNote ?? null, shiftId]
  )

  return NextResponse.json({ ok: true })
}

// DELETE /api/staff-schedule — delete shift
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { shiftId } = await req.json()
  if (!shiftId) return NextResponse.json({ error: 'shiftId required' }, { status: 400 })

  if (session.role === 'manager') {
    const shift = await queryOne<{ store_location_id: string; shift_date: string }>(
      `SELECT store_location_id, shift_date::text FROM scheduled_shifts WHERE id = $1`,
      [shiftId]
    )
    if (!shift) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const access = await queryOne(
      `SELECT 1 FROM dm_manager_stores WHERE manager_id = $1 AND store_location_id = $2`,
      [session.id, shift.store_location_id]
    )
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const weekStart = getWeekMonday(shift.shift_date)
    const pub = await queryOne(
      `SELECT 1 FROM scheduled_shifts_publish WHERE store_location_id = $1 AND week_start = $2`,
      [shift.store_location_id, weekStart]
    )
    if (pub) return NextResponse.json({ error: 'Cannot delete shifts from a published week' }, { status: 400 })
  }

  await query(`DELETE FROM scheduled_shifts WHERE id = $1`, [shiftId])
  return NextResponse.json({ ok: true })
}

// Helper: given a date string YYYY-MM-DD, return the Monday of that week
function getWeekMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}
