import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/calendar/debug?userId=<uuid>&year=2026&month=5
// Restricted to owner/developer — used to diagnose invited-events issues
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !['owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId') ?? session.id
  const year   = parseInt(searchParams.get('year')  ?? String(new Date().getFullYear()))
  const month  = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1))

  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay  = new Date(year, month, 0).toISOString().split('T')[0]

  const results: Record<string, unknown> = { userId, firstDay, lastDay }

  // 1. Does calendar_event_attendees table exist?
  try {
    const tables = await query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'calendar_event_attendees'
      ) AS exists
    `)
    results.attendeesTableExists = tables[0]?.exists
  } catch (e) {
    results.attendeesTableExistsError = String(e)
  }

  // 2. Count all attendee rows
  try {
    const count = await query<{ count: string }>(`SELECT COUNT(*) FROM calendar_event_attendees`)
    results.totalAttendeeRows = count[0]?.count
  } catch (e) {
    results.totalAttendeeRowsError = String(e)
  }

  // 3. Attendee rows for this user
  try {
    const rows = await query<{ event_id: string; status: string; created_at: string }>(`
      SELECT event_id::text, status, created_at::text
      FROM calendar_event_attendees
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `, [userId])
    results.attendeeRowsForUser = rows
  } catch (e) {
    results.attendeeRowsForUserError = String(e)
  }

  // 4. Unique constraint check
  try {
    const constraints = await query<{ constraint_name: string; constraint_type: string }>(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'calendar_event_attendees'
    `)
    results.attendeesTableConstraints = constraints
  } catch (e) {
    results.attendeesTableConstraintsError = String(e)
  }

  // 5. Invited events raw query for this user and month
  try {
    const invited = await query(`
      SELECT
        e.id::text, e.title, e.start_date::text, e.end_date::text,
        e.calendar_owner_id::text, a.status,
        e.recurrence
      FROM calendar_events e
      JOIN calendar_event_attendees a ON a.event_id = e.id
      WHERE a.user_id = $1
        AND e.calendar_owner_id != $1
        AND (
          (e.recurrence = 'none' AND e.start_date <= $2 AND e.end_date >= $3)
          OR (e.recurrence != 'none' AND e.start_date <= $2)
        )
      ORDER BY e.start_date
    `, [userId, lastDay, firstDay])
    results.invitedEventsForMonth = invited
  } catch (e) {
    results.invitedEventsError = String(e)
  }

  // 6. calendar_owner_id column check
  try {
    const cols = await query<{ column_name: string; data_type: string }>(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'calendar_events'
        AND column_name IN ('calendar_owner_id', 'all_day', 'location', 'recurrence', 'task_id')
    `)
    results.calendarEventsColumns = cols
  } catch (e) {
    results.calendarEventsColumnsError = String(e)
  }

  // 7. Sample of recent calendar_events with owner info
  try {
    const evs = await query(`
      SELECT e.id::text, e.title, e.calendar_owner_id::text, e.created_by::text,
             e.start_date::text, e.created_at::text,
             u.full_name AS owner_name
      FROM calendar_events e
      LEFT JOIN users u ON u.id = e.calendar_owner_id
      ORDER BY e.created_at DESC
      LIMIT 10
    `)
    results.recentEvents = evs
  } catch (e) {
    results.recentEventsError = String(e)
  }

  return NextResponse.json(results, { status: 200 })
}
