import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

const CAN_ACCESS = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']
const VALID_STATUSES = ['accepted', 'declined', 'maybe']

// PATCH /api/calendar/rsvp
// Body: { eventId, status: 'accepted' | 'declined' | 'maybe' }
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !CAN_ACCESS.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { eventId, status } = await req.json()
  if (!eventId || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'eventId and valid status required' }, { status: 400 })
  }

  // Verify attendee record exists
  const row = await queryOne(
    `SELECT id FROM calendar_event_attendees WHERE event_id = $1 AND user_id = $2`,
    [eventId, session.id]
  )
  if (!row) {
    return NextResponse.json({ error: 'You are not an attendee of this event' }, { status: 403 })
  }

  await query(`
    UPDATE calendar_event_attendees
    SET status = $1, responded_at = NOW()
    WHERE event_id = $2 AND user_id = $3
  `, [status, eventId, session.id])

  // Notify the event creator
  const event = await queryOne<{ created_by: string | null; title: string; calendar_owner_id: string }>(
    `SELECT created_by::text, title, calendar_owner_id::text FROM calendar_events WHERE id = $1`, [eventId]
  )
  if (event?.created_by && event.created_by !== session.id) {
    const statusLabel = status === 'accepted' ? 'accepted' : status === 'declined' ? 'declined' : 'marked maybe for'
    query(
      `INSERT INTO notifications (user_id, title, body, type) VALUES ($1,$2,$3,'calendar_rsvp')`,
      [event.created_by, `RSVP Update: ${event.title}`, `${session.fullName} ${statusLabel} "${event.title}".`]
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
