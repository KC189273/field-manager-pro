import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'

export const dynamic = 'force-dynamic'

// GET /api/cron/calendar-reminders — runs every 15 minutes via Vercel cron
// Finds due reminders, sends push notifications, marks them sent
export async function GET() {
  try {
    const due = await query<{
      id: string
      event_id: string
      user_id: string
      title: string
      start_date: string
      start_time: string | null
      all_day: boolean
    }>(`
      SELECT r.id::text, r.event_id::text, r.user_id::text,
             e.title, e.start_date::text, e.start_time::text, e.all_day
      FROM calendar_reminders r
      JOIN calendar_events e ON e.id = r.event_id
      WHERE r.sent_at IS NULL
        AND r.remind_at <= NOW()
        AND r.remind_at >= NOW() - INTERVAL '20 minutes'
    `)

    if (due.length === 0) return NextResponse.json({ sent: 0 })

    let sent = 0
    for (const row of due) {
      const timeLabel = row.all_day
        ? row.start_date
        : `${row.start_date}${row.start_time ? ' at ' + fmtTime(row.start_time) : ''}`

      await sendPushToUser(
        row.user_id,
        `Upcoming: ${row.title}`,
        `Your event "${row.title}" is coming up on ${timeLabel}.`,
        'calendar_event'
      )

      await query(`UPDATE calendar_reminders SET sent_at = NOW() WHERE id = $1`, [row.id])
      sent++
    }

    return NextResponse.json({ sent })
  } catch (e) {
    console.error('calendar-reminders cron error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
