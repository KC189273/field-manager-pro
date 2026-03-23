import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendEmail, scheduleSubmittedHtml } from '@/lib/notifications'
import { nextWeekStart, formatWeekRange, dayIndexToName } from '@/lib/schedule'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const weekStart = searchParams.get('week') // YYYY-MM-DD
  const userId = searchParams.get('userId') ?? session.id

  if (userId !== session.id && session.role !== 'manager' && session.role !== 'ops_manager' && session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (weekStart) {
    const schedule = await queryOne(
      `SELECT * FROM schedules WHERE user_id = $1 AND week_start = $2`,
      [userId, weekStart]
    )
    return NextResponse.json({ schedule })
  }

  // Return all schedules for this user
  const schedules = await query(
    `SELECT * FROM schedules WHERE user_id = $1 ORDER BY week_start DESC LIMIT 8`,
    [userId]
  )
  return NextResponse.json({ schedules })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { daysWorking, weekStart } = await req.json()
  if (!Array.isArray(daysWorking)) return NextResponse.json({ error: 'Missing daysWorking' }, { status: 400 })

  const targetWeek = weekStart ?? nextWeekStart().toISOString().split('T')[0]

  await query(
    `INSERT INTO schedules (user_id, week_start, days_working)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, week_start) DO UPDATE SET days_working = $3, submitted_at = NOW()`,
    [session.id, targetWeek, daysWorking]
  )

  // Notify managers/ops/developer
  const config = await queryOne<{ value: string }>(
    `SELECT value FROM dev_config WHERE key = 'schedule_submit_notify_manager'`
  )
  const notifyMgr = config?.value !== 'false'

  if (notifyMgr) {
    const dayNames = daysWorking.map(dayIndexToName)
    const weekDate = new Date(targetWeek + 'T12:00:00Z')
    const html = scheduleSubmittedHtml(session.fullName, formatWeekRange(weekDate), dayNames)

    const recipients = await query<{ email: string }>(
      `SELECT email FROM users WHERE role IN ('manager','ops_manager') AND is_active = TRUE`
    )
    const devConfig = await queryOne<{ value: string }>(
      `SELECT value FROM dev_config WHERE key = 'schedule_submit_notify_developer'`
    )
    if (devConfig?.value !== 'false') {
      const devs = await query<{ email: string }>(
        `SELECT email FROM users WHERE role = 'developer' AND is_active = TRUE`
      )
      recipients.push(...devs)
    }

    const emails = [...new Set(recipients.map(r => r.email))]
    for (const email of emails) {
      await sendEmail(email, `FMP: Schedule submitted — ${session.fullName}`, html)
    }
  }

  return NextResponse.json({ ok: true })
}
