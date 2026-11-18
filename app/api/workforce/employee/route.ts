import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const CST = 'America/Chicago'
const ALLOWED = ['employee', 'manager', 'ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer', 'prospect']

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const employeeId = searchParams.get('id')
  const weekStart = searchParams.get('weekStart')
  const weekEnd = searchParams.get('weekEnd')

  if (!employeeId || !weekStart || !weekEnd) {
    return NextResponse.json({ error: 'id, weekStart, weekEnd required' }, { status: 400 })
  }

  try {
  // DMs can only view their direct reports
  if (session.role === 'manager') {
    const emp = await queryOne<{ manager_id: string | null }>(`SELECT manager_id FROM users WHERE id = $1`, [employeeId])
    if (emp?.manager_id !== session.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const employee = await queryOne<{
    id: string; full_name: string; role: string; username: string
    manager_name: string | null; pay_type: string | null
  }>(`
    SELECT u.id, u.full_name, u.role, u.username,
           m.full_name as manager_name, u.pay_type
    FROM users u
    LEFT JOIN users m ON m.id = u.manager_id
    WHERE u.id = $1
  `, [employeeId])

  if (!employee) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Scheduled shifts
  const schedules = await query<{
    shift_date: string; store_id: string | null; store_address: string | null
    start_time: string | null; end_time: string | null; break_minutes: number | null
  }>(`
    SELECT ss.shift_date::text, ss.store_location_id as store_id,
           sl.address as store_address,
           ss.start_time::text, ss.end_time::text, ss.break_minutes
    FROM scheduled_shifts ss
    LEFT JOIN dm_store_locations sl ON sl.id = ss.store_location_id
    WHERE ss.employee_id = $1 AND ss.shift_date >= $2::date AND ss.shift_date <= $3::date
    ORDER BY ss.shift_date
  `, [employeeId, weekStart, weekEnd])

  // Actual shifts with breaks
  const shifts = await query<{
    id: string; store_id: string | null; store_address: string | null
    clock_in_at: string; clock_out_at: string | null
    is_manual: boolean; manual_note: string | null
    duration_seconds: number; break_seconds: number
    breaks: Array<{ id: string; break_start: string; break_end: string | null }> | null
  }>(`
    SELECT s.id, s.store_location_id as store_id, sl.address as store_address,
           s.clock_in_at::text, s.clock_out_at::text,
           s.is_manual, s.manual_note,
           EXTRACT(EPOCH FROM (COALESCE(s.clock_out_at, NOW()) - s.clock_in_at)) as duration_seconds,
           COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start)))
             FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0) as break_seconds,
           (SELECT json_agg(json_build_object('id', b.id, 'break_start', b.break_start, 'break_end', b.break_end) ORDER BY b.break_start)
            FROM shift_breaks b WHERE b.shift_id = s.id) as breaks
    FROM shifts s
    LEFT JOIN dm_store_locations sl ON sl.id = s.store_location_id
    WHERE s.user_id = $1
      AND (s.clock_in_at AT TIME ZONE $4)::date >= $2::date
      AND (s.clock_in_at AT TIME ZONE $4)::date <= $3::date
    ORDER BY s.clock_in_at
  `, [employeeId, weekStart, weekEnd, CST])

  // Coworkers at same stores on same days
  const coworkersByDay = new Map<string, string[]>()
  for (const shift of shifts) {
    if (!shift.store_id) continue
    const shiftDate = new Date(shift.clock_in_at).toLocaleDateString('en-CA', { timeZone: CST })
    const coworkers = await query<{ full_name: string }>(`
      SELECT DISTINCT u.full_name FROM shifts s
      JOIN users u ON u.id = s.user_id
      WHERE s.store_location_id = $1 AND s.user_id != $2
        AND (s.clock_in_at AT TIME ZONE $4)::date = $3::date
      ORDER BY u.full_name LIMIT 5
    `, [shift.store_id, employeeId, shiftDate, CST])
    coworkersByDay.set(shiftDate, coworkers.map(c => c.full_name))
  }

  return NextResponse.json({
    employee,
    schedules,
    shifts,
    coworkers: Object.fromEntries(coworkersByDay),
  })
  } catch (err) {
    console.error('Workforce employee error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
