import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

interface ShiftRow {
  id: string
  store_location_id: string
  store_address: string
  employee_id: string | null
  employee_name: string | null
  shift_date: string
  start_time: string
  end_time: string
  role_note: string | null
  break_minutes: number
  is_on_call: boolean
  is_dm_shift: boolean
}

async function ensureColumns() {
  await query(`ALTER TABLE scheduled_shifts ADD COLUMN IF NOT EXISTS break_minutes SMALLINT NOT NULL DEFAULT 0`)
  await query(`ALTER TABLE scheduled_shifts ADD COLUMN IF NOT EXISTS is_on_call BOOLEAN NOT NULL DEFAULT FALSE`)
  await query(`ALTER TABLE scheduled_shifts ADD COLUMN IF NOT EXISTS is_dm_shift BOOLEAN NOT NULL DEFAULT FALSE`)
  await query(`ALTER TABLE scheduled_shifts ALTER COLUMN employee_id DROP NOT NULL`).catch(() => {})
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

  try { await ensureColumns() } catch {}

  // Employees: read-only, own published shifts only
  if (session.role === 'employee') {
    const shifts = await query<ShiftRow>(`
      SELECT
        ss.id, ss.store_location_id, sl.address AS store_address,
        ss.employee_id, u.full_name AS employee_name,
        ss.shift_date::text AS shift_date,
        ss.start_time::text AS start_time,
        ss.end_time::text   AS end_time,
        ss.role_note, COALESCE(ss.break_minutes, 0) AS break_minutes,
        COALESCE(ss.is_on_call, FALSE) AS is_on_call,
        COALESCE(ss.is_dm_shift, FALSE) AS is_dm_shift
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

  // Employee view — all shifts across all accessible stores for the week
  if (searchParams.get('employeeView') === 'true') {
    let shifts: ShiftRow[]
    if (session.role === 'manager') {
      const assigned = await query<{ store_location_id: string }>(
        `SELECT store_location_id FROM dm_manager_stores WHERE manager_id = $1`,
        [session.id]
      )
      if (assigned.length === 0) return NextResponse.json({ shifts: [], isPublished: false })
      const ids = assigned.map(r => r.store_location_id)
      shifts = await query<ShiftRow>(`
        SELECT ss.id, ss.store_location_id, sl.address AS store_address,
               ss.employee_id, u.full_name AS employee_name,
               ss.shift_date::text AS shift_date,
               ss.start_time::text AS start_time,
               ss.end_time::text AS end_time,
               ss.role_note, COALESCE(ss.break_minutes, 0) AS break_minutes,
               COALESCE(ss.is_on_call, FALSE) AS is_on_call,
        COALESCE(ss.is_dm_shift, FALSE) AS is_dm_shift
        FROM scheduled_shifts ss
        JOIN users u ON u.id = ss.employee_id
        JOIN dm_store_locations sl ON sl.id = ss.store_location_id
        WHERE ss.store_location_id = ANY($1)
          AND ss.shift_date >= $2 AND ss.shift_date <= $3
        ORDER BY u.full_name, ss.shift_date, ss.start_time
      `, [ids, weekStart, weekEndStr])
    } else {
      const orgId = session.org_id ?? null
      shifts = await query<ShiftRow>(`
        SELECT ss.id, ss.store_location_id, sl.address AS store_address,
               ss.employee_id, u.full_name AS employee_name,
               ss.shift_date::text AS shift_date,
               ss.start_time::text AS start_time,
               ss.end_time::text AS end_time,
               ss.role_note, COALESCE(ss.break_minutes, 0) AS break_minutes,
               COALESCE(ss.is_on_call, FALSE) AS is_on_call,
        COALESCE(ss.is_dm_shift, FALSE) AS is_dm_shift
        FROM scheduled_shifts ss
        JOIN users u ON u.id = ss.employee_id
        JOIN dm_store_locations sl ON sl.id = ss.store_location_id
        ${orgId ? 'WHERE ss.org_id = $1 AND ss.shift_date >= $2 AND ss.shift_date <= $3' : 'WHERE ss.shift_date >= $1 AND ss.shift_date <= $2'}
        ORDER BY u.full_name, ss.shift_date, ss.start_time
      `, orgId ? [orgId, weekStart, weekEndStr] : [weekStart, weekEndStr])
    }
    return NextResponse.json({ shifts, isPublished: false })
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
      ss.role_note, COALESCE(ss.break_minutes, 0) AS break_minutes,
      COALESCE(ss.is_on_call, FALSE) AS is_on_call
    FROM scheduled_shifts ss
    LEFT JOIN users u ON u.id = ss.employee_id
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
  try { await ensureColumns() } catch {}

  const { storeId, employeeId, shiftDate, startTime, endTime, roleNote, breakMinutes, isOnCall, isDmShift } = await req.json()

  if (!storeId || !employeeId || !shiftDate || !startTime || !endTime) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!isOnCall && startTime >= endTime) {
    return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 })
  }

  // Verify store access for managers
  if (session.role === 'manager') {
    const access = await queryOne(
      `SELECT 1 FROM dm_manager_stores WHERE manager_id = $1 AND store_location_id = $2`,
      [session.id, storeId]
    )
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  }

  // Check for approved time off on this date (skip for on-call shifts and DM coverage shifts)
  if (!isOnCall && !isDmShift) {
    const timeOff = await queryOne<{
      partial_day: boolean
      partial_start_time: string | null
      partial_end_time: string | null
    }>(
      `SELECT partial_day, partial_start_time::text, partial_end_time::text
       FROM time_off_requests
       WHERE user_id = $1 AND status = 'approved'
         AND start_date <= $2::date AND end_date >= $2::date
       LIMIT 1`,
      [employeeId, shiftDate]
    ).catch(() => null)
    if (timeOff) {
      if (!timeOff.partial_day) {
        return NextResponse.json({ error: 'This employee has approved time off on that date.' }, { status: 400 })
      }
      // Partial day — only block if shift overlaps the approved time-off window
      if (timeOff.partial_start_time && timeOff.partial_end_time && startTime < timeOff.partial_end_time && endTime > timeOff.partial_start_time) {
        return NextResponse.json({
          error: `This employee has approved time off from ${timeOff.partial_start_time.slice(0, 5)} to ${timeOff.partial_end_time.slice(0, 5)} on that date.`
        }, { status: 400 })
      }
    }
  }

  const store = await queryOne<{ org_id: string | null }>(
    `SELECT org_id FROM dm_store_locations WHERE id = $1`,
    [storeId]
  )

  const result = await queryOne<{ id: string }>(
    `INSERT INTO scheduled_shifts
       (org_id, store_location_id, employee_id, shift_date, start_time, end_time, role_note, created_by, break_minutes, is_on_call, is_dm_shift)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [store?.org_id ?? null, storeId, employeeId, shiftDate, startTime, endTime, roleNote || null, session.id, breakMinutes ?? 0, isOnCall ? true : false, isDmShift ? true : false]
  )

  return NextResponse.json({ ok: true, id: result?.id })
}

// PATCH /api/staff-schedule — update shift
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try { await ensureColumns() } catch {}

  const { shiftId, employeeId, shiftDate, startTime, endTime, roleNote, breakMinutes, isOnCall, isDmShift } = await req.json()
  if (!shiftId) return NextResponse.json({ error: 'shiftId required' }, { status: 400 })

  if (!isOnCall && startTime && endTime && startTime >= endTime) {
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

  }

  // Check for approved time off if employee or date is changing
  if (employeeId || shiftDate) {
    const current = await queryOne<{ employee_id: string; shift_date: string; start_time: string; end_time: string }>(
      `SELECT employee_id, shift_date::text, start_time::text, end_time::text FROM scheduled_shifts WHERE id = $1`,
      [shiftId]
    )
    if (current) {
      const checkEmployeeId = employeeId ?? current.employee_id
      const checkDate = shiftDate ?? current.shift_date
      const checkStart = startTime ?? current.start_time
      const checkEnd = endTime ?? current.end_time
      const timeOff = await queryOne<{
        partial_day: boolean
        partial_start_time: string | null
        partial_end_time: string | null
      }>(
        `SELECT partial_day, partial_start_time::text, partial_end_time::text
         FROM time_off_requests
         WHERE user_id = $1 AND status = 'approved'
           AND start_date <= $2::date AND end_date >= $2::date
         LIMIT 1`,
        [checkEmployeeId, checkDate]
      ).catch(() => null)
      if (timeOff) {
        if (!timeOff.partial_day) {
          return NextResponse.json({ error: 'This employee has approved time off on that date.' }, { status: 400 })
        }
        if (timeOff.partial_start_time && timeOff.partial_end_time && checkStart < timeOff.partial_end_time && checkEnd > timeOff.partial_start_time) {
          return NextResponse.json({
            error: `This employee has approved time off from ${timeOff.partial_start_time.slice(0, 5)} to ${timeOff.partial_end_time.slice(0, 5)} on that date.`
          }, { status: 400 })
        }
      }
    }
  }

  await query(
    `UPDATE scheduled_shifts
     SET employee_id   = COALESCE($1, employee_id),
         shift_date    = COALESCE($2, shift_date),
         start_time    = COALESCE($3, start_time),
         end_time      = COALESCE($4, end_time),
         role_note     = $5,
         break_minutes = COALESCE($6, break_minutes),
         is_on_call    = COALESCE($7, is_on_call),
         is_dm_shift   = COALESCE($8, is_dm_shift),
         updated_at    = NOW()
     WHERE id = $9`,
    [employeeId ?? null, shiftDate ?? null, startTime ?? null, endTime ?? null, roleNote ?? null, breakMinutes ?? null, isOnCall ?? null, isDmShift ?? null, shiftId]
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
