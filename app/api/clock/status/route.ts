import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { nextWeekStart, nextWeekDeadline, daysUntilDeadline } from '@/lib/schedule'

let ensured = false
async function ensureShiftColumns() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS store_location_id UUID`)
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Ensure store_location_id column exists before joining on it
  try { await ensureShiftColumns() } catch {}

  // Active shift
  const activeShift = await queryOne<{ id: string; clock_in_at: string; clock_in_lat: string; clock_in_lng: string; clock_in_address: string; store_location_id: string | null; store_address: string | null }>(
    `SELECT s.id, s.clock_in_at, s.clock_in_lat, s.clock_in_lng, s.clock_in_address,
            s.store_location_id, dsl.address AS store_address
     FROM shifts s
     LEFT JOIN dm_store_locations dsl ON dsl.id = s.store_location_id
     WHERE s.user_id = $1 AND s.clock_in_at IS NOT NULL AND s.clock_out_at IS NULL`,
    [session.id]
  )

  // Active break (if on break right now)
  const activeBreak = activeShift
    ? await queryOne<{ id: string; break_start: string }>(
        `SELECT id, break_start FROM shift_breaks
         WHERE shift_id = $1 AND break_end IS NULL`,
        [activeShift.id]
      ).catch(() => null)
    : null

  // Next week schedule
  const nws = nextWeekStart()
  const nwsDate = nws.toISOString().split('T')[0]
  const schedule = await queryOne<{ days_working: number[] }>(
    `SELECT days_working FROM schedules WHERE user_id = $1 AND week_start = $2`,
    [session.id, nwsDate]
  )

  // Current week schedule (for today's day check)
  const today = new Date()
  const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1 // 0=Mon...6=Sun
  const cwsDate = new Date(today)
  cwsDate.setDate(today.getDate() - dayOfWeek)
  cwsDate.setHours(0, 0, 0, 0)

  const currentSchedule = await queryOne<{ days_working: number[] }>(
    `SELECT days_working FROM schedules WHERE user_id = $1 AND week_start = $2`,
    [session.id, cwsDate.toISOString().split('T')[0]]
  )

  const isScheduledToday = currentSchedule?.days_working?.includes(dayOfWeek) ?? false
  const daysLeft = daysUntilDeadline()
  const deadline = nextWeekDeadline()
  const overdue = daysLeft < 0

  // Today's scheduled shifts from the staff schedule
  const todayCSTStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const todayShifts = await query<{
    start_time: string
    end_time: string
    store_address: string
    role_note: string | null
    break_minutes: number
  }>(
    `SELECT ss.start_time::text, ss.end_time::text,
            sl.address AS store_address, ss.role_note,
            COALESCE(ss.break_minutes, 0) AS break_minutes
     FROM scheduled_shifts ss
     JOIN dm_store_locations sl ON sl.id = ss.store_location_id
     WHERE ss.employee_id = $1 AND ss.shift_date = $2
     ORDER BY ss.start_time`,
    [session.id, todayCSTStr]
  ).catch(() => [])

  return NextResponse.json({
    activeShift,
    activeBreak,
    nextWeekScheduleSubmitted: !!schedule,
    nextWeekStart: nwsDate,
    deadlineDaysLeft: daysLeft,
    deadlineDate: deadline.toISOString(),
    scheduleOverdue: overdue,
    isScheduledToday,
    todayDayIndex: dayOfWeek,
    todayShifts,
  })
}
