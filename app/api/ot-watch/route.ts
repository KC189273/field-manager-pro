import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

// Returns OT watch list for the current week — visible to managers+
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Current week boundaries (Mon-Sun)
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const weekStart = monday.toISOString().split('T')[0]
  const weekEnd = sunday.toISOString().split('T')[0]
  const today = now.toISOString().split('T')[0]

  // Get employees visible to this user
  let employeeFilter = ''
  const params: unknown[] = [weekStart, weekEnd + 'T23:59:59', today, weekEnd]

  if (session.role === 'manager') {
    params.push(session.id)
    employeeFilter = `AND (u.manager_id = $${params.length} OR u.is_floater = TRUE)`
  }

  const employees = await query<{
    id: string; full_name: string; is_floater: boolean
    worked_hours: number; scheduled_remaining: number
  }>(`
    SELECT
      u.id, u.full_name, COALESCE(u.is_floater, false) as is_floater,
      COALESCE((
        SELECT SUM(
          EXTRACT(EPOCH FROM (COALESCE(s.clock_out_at, NOW()) - s.clock_in_at))
          - COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start)))
                      FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)
        ) / 3600
        FROM shifts s
        WHERE s.user_id = u.id AND s.clock_in_at >= $1 AND s.clock_in_at <= $2
      ), 0)::float as worked_hours,
      COALESCE((
        SELECT SUM(
          EXTRACT(EPOCH FROM ((ss.shift_date + ss.end_time) - (ss.shift_date + ss.start_time))) / 3600
          - COALESCE(ss.break_minutes, 0) / 60.0
        )
        FROM scheduled_shifts ss
        WHERE ss.employee_id = u.id AND ss.shift_date > $3 AND ss.shift_date <= $4
          AND EXISTS (
            SELECT 1 FROM scheduled_shifts_publish ssp
            WHERE ssp.store_location_id = ss.store_location_id
              AND ssp.week_start = ss.shift_date - ((EXTRACT(DOW FROM ss.shift_date)::int + 6) % 7)
          )
      ), 0)::float as scheduled_remaining
    FROM users u
    WHERE u.role = 'employee' AND u.is_active = TRUE AND (u.is_hidden = FALSE OR u.is_hidden IS NULL)
      ${employeeFilter}
    ORDER BY u.full_name
  `, params)

  // Only return employees with projected 35+ hours (near the threshold)
  const watchList = employees
    .map(e => ({
      ...e,
      projected_hours: e.worked_hours + e.scheduled_remaining,
    }))
    .filter(e => e.projected_hours >= 35)
    .sort((a, b) => b.projected_hours - a.projected_hours)

  return NextResponse.json({
    watchList,
    weekLabel: `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
  })
}
