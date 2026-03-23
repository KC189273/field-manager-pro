import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { queryOne } from '@/lib/db'
import { nextWeekStart, nextWeekDeadline, daysUntilDeadline } from '@/lib/schedule'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Active shift
  const activeShift = await queryOne<{ id: string; clock_in_at: string; clock_in_lat: string; clock_in_lng: string; clock_in_address: string }>(
    `SELECT id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_address
     FROM shifts WHERE user_id = $1 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL`,
    [session.id]
  )

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

  return NextResponse.json({
    activeShift,
    nextWeekScheduleSubmitted: !!schedule,
    nextWeekStart: nwsDate,
    deadlineDaysLeft: daysLeft,
    deadlineDate: deadline.toISOString(),
    scheduleOverdue: overdue,
    isScheduledToday,
    todayDayIndex: dayOfWeek,
  })
}
