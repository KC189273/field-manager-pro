import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'
import { sendPushToUser, sendPushToUsers } from '@/lib/apns'

export const dynamic = 'force-dynamic'

// Roles allowed to use the calendar system at all
const CAN_ACCESS = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']
// Roles that have their own personal calendar
const HAS_OWN_CALENDAR = ['manager', 'sales_director']
// Roles that can view/edit other users' (DM) calendars
const CAN_VIEW_TEAM = ['ops_manager', 'owner', 'developer', 'sales_director']

const CAT_LABELS: Record<string, string> = {
  travel: 'Travel', meeting: 'Meeting', store_visit: 'Store Visit',
  blocked: 'Blocked', other: 'Event',
}

// ── DDL ──────────────────────────────────────────────────────────────────────

let ensured = false
async function ensureTables() {
  if (ensured) return
  ensured = true

  // Extend existing calendar_events table
  await query(`
    ALTER TABLE calendar_events
      ADD COLUMN IF NOT EXISTS calendar_owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS all_day           BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS location          TEXT,
      ADD COLUMN IF NOT EXISTS recurrence        TEXT NOT NULL DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS recurrence_id     UUID,
      ADD COLUMN IF NOT EXISTS task_id           UUID
  `).catch(() => {})
  await query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS exception_date TEXT`).catch(() => {})
  await query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {})

  // Migrate existing events: assign to their creator (Kyle's events go to Kyle, owner's to owner)
  await query(`
    UPDATE calendar_events
    SET calendar_owner_id = created_by
    WHERE calendar_owner_id IS NULL AND created_by IS NOT NULL
  `).catch(() => {})

  // Fallback: any remaining null owners → find Kyle Hodges
  await query(`
    UPDATE calendar_events
    SET calendar_owner_id = (
      SELECT id FROM users WHERE full_name = 'Kyle Hodges' LIMIT 1
    )
    WHERE calendar_owner_id IS NULL
  `).catch(() => {})

  // Attendees / RSVP
  await query(`
    CREATE TABLE IF NOT EXISTS calendar_event_attendees (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id     UUID NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status       TEXT NOT NULL DEFAULT 'invited',
      responded_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (event_id, user_id)
    )
  `).catch(() => {})

  // Ensure the unique constraint exists even if table was created without it
  await query(`
    ALTER TABLE calendar_event_attendees
      ADD CONSTRAINT IF NOT EXISTS calendar_event_attendees_event_id_user_id_key
      UNIQUE (event_id, user_id)
  `).catch(() => {})

  // Reminders
  await query(`
    CREATE TABLE IF NOT EXISTS calendar_reminders (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id   UUID NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      remind_at  TIMESTAMPTZ NOT NULL,
      sent_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {})

  // Attachments
  await query(`
    CREATE TABLE IF NOT EXISTS calendar_event_attachments (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id     UUID NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      s3_key       TEXT NOT NULL,
      filename     TEXT NOT NULL,
      content_type TEXT,
      created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {})
}

// ── Recurrence expansion ─────────────────────────────────────────────────────

interface CalEventRow {
  id: string
  title: string
  category: string
  start_date: string
  start_time: string | null
  end_date: string
  end_time: string | null
  notes: string | null
  all_day: boolean
  location: string | null
  recurrence: string
  recurrence_id: string | null
  task_id: string | null
  calendar_owner_id: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  exception_date: string | null
  is_cancelled: boolean
  attendees?: AttendeeRow[]
  attachments?: AttachmentRow[]
}

interface AttendeeRow {
  user_id: string
  full_name: string
  status: string
}

interface AttachmentRow {
  id: string
  s3_key: string
  filename: string
  content_type: string | null
}

function advanceCursor(d: Date, recurrence: string): Date {
  const c = new Date(d)
  switch (recurrence) {
    case 'daily':    c.setUTCDate(c.getUTCDate() + 1); break
    case 'weekly':   c.setUTCDate(c.getUTCDate() + 7); break
    case 'biweekly': c.setUTCDate(c.getUTCDate() + 14); break
    case 'monthly':  c.setUTCMonth(c.getUTCMonth() + 1); break
    default:         c.setUTCFullYear(9999) // stop
  }
  return c
}

function firstOccurrenceOnOrAfter(origStart: Date, firstDay: Date, recurrence: string): Date {
  const cursor = new Date(origStart)
  if (cursor >= firstDay) return cursor

  // Jump most of the way there
  const diffMs   = firstDay.getTime() - origStart.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)
  switch (recurrence) {
    case 'daily':    cursor.setUTCDate(cursor.getUTCDate() + diffDays); break
    case 'weekly':   cursor.setUTCDate(cursor.getUTCDate() + Math.floor(diffDays / 7) * 7); break
    case 'biweekly': cursor.setUTCDate(cursor.getUTCDate() + Math.floor(diffDays / 14) * 14); break
    case 'monthly': {
      const months = (firstDay.getUTCFullYear() - origStart.getUTCFullYear()) * 12
                   + (firstDay.getUTCMonth()   - origStart.getUTCMonth())
      cursor.setUTCMonth(cursor.getUTCMonth() + Math.max(0, months - 1))
      break
    }
  }

  // Fine-tune
  let guard = 0
  while (cursor < firstDay && guard++ < 50) {
    const next = advanceCursor(cursor, recurrence)
    if (next <= cursor) break
    cursor.setTime(next.getTime())
  }
  return cursor
}

function expandRecurring(ev: CalEventRow, firstDay: string, lastDay: string, excludeDates: Set<string> = new Set()): CalEventRow[] {
  if (ev.recurrence === 'none') return [ev]

  const first = new Date(firstDay + 'T00:00:00Z')
  const last  = new Date(lastDay  + 'T23:59:59Z')

  const origStart = new Date(ev.start_date + 'T12:00:00Z')
  const origEnd   = new Date(ev.end_date   + 'T12:00:00Z')
  const durationMs = Math.max(0, origEnd.getTime() - origStart.getTime())

  let cursor = firstOccurrenceOnOrAfter(origStart, first, ev.recurrence)
  const result: CalEventRow[] = []

  let guard = 0
  while (cursor <= last && guard++ < 100) {
    const instEnd = new Date(cursor.getTime() + durationMs)
    const dateStr = cursor.toISOString().split('T')[0]
    if (instEnd >= first && !excludeDates.has(dateStr)) {
      result.push({
        ...ev,
        start_date: dateStr,
        end_date:   instEnd.toISOString().split('T')[0],
      })
    }
    const next = advanceCursor(cursor, ev.recurrence)
    if (next <= cursor) break
    cursor = next
  }

  return result
}

// ── GET /api/calendar ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !CAN_ACCESS.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTables() } catch {}

  const { searchParams } = new URL(req.url)
  const year    = parseInt(searchParams.get('year')  ?? String(new Date().getFullYear()))
  const month   = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1))
  const ownerId = searchParams.get('ownerId') ?? null  // viewing someone else's calendar

  // Validate ownerId access
  if (ownerId && ownerId !== session.id) {
    if (!CAN_VIEW_TEAM.includes(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // sales_director can only view managers in their org; ops+/owner can view any manager in org
    const orgFilter = await getOrgFilter(session)
    if (orgFilter.filterByOrg && orgFilter.orgId) {
      const ownerRow = await queryOne<{ org_id: string; role: string }>(
        `SELECT org_id, role FROM users WHERE id = $1`, [ownerId]
      )
      if (!ownerRow || ownerRow.org_id !== orgFilter.orgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (!HAS_OWN_CALENDAR.includes(ownerRow.role)) {
        return NextResponse.json({ error: 'That user does not have a calendar' }, { status: 400 })
      }
    }
  }

  const targetOwnerId = ownerId ?? session.id

  // Date range for this month
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay  = new Date(year, month, 0).toISOString().split('T')[0]

  // Fetch seed events — include recurring that start before lastDay
  const rawEvents = await query<CalEventRow>(`
    SELECT
      id, title, category,
      start_date::text, start_time::text,
      end_date::text,   end_time::text,
      notes, all_day, location, recurrence, recurrence_id::text,
      task_id::text, calendar_owner_id::text,
      created_by::text, created_by_name, created_at::text,
      exception_date, is_cancelled
    FROM calendar_events
    WHERE calendar_owner_id = $1
      AND (
        (recurrence = 'none' AND start_date <= $2 AND end_date >= $3)
        OR (recurrence != 'none' AND start_date <= $2)
      )
    ORDER BY start_date, start_time NULLS LAST
  `, [targetOwnerId, lastDay, firstDay])

  // Fetch events where the calendar owner is an invited attendee on someone else's calendar.
  // This runs for both own-view and team-view so elevated users see the full picture.
  let invitedEvents: CalEventRow[] = []
  let declinedEvents: CalEventRow[] = []
  const attendeeBase = `
    SELECT
      e.id, e.title, e.category,
      e.start_date::text, e.start_time::text,
      e.end_date::text,   e.end_time::text,
      e.notes, e.all_day, e.location, e.recurrence, e.recurrence_id::text,
      e.task_id::text, e.calendar_owner_id::text,
      e.created_by::text, e.created_by_name, e.created_at::text,
      e.exception_date, e.is_cancelled
    FROM calendar_events e
    JOIN calendar_event_attendees a ON a.event_id = e.id
    WHERE a.user_id = $1
      AND e.calendar_owner_id != $1
      AND (
        (e.recurrence = 'none' AND e.start_date <= $2 AND e.end_date >= $3)
        OR (e.recurrence != 'none' AND e.start_date <= $2)
      )`

  // Non-declined: invited, accepted, maybe — all show on the calendar
  invitedEvents = await query<CalEventRow>(
    attendeeBase + ` AND a.status != 'declined'`,
    [targetOwnerId, lastDay, firstDay]
  )

  // Declined: audit trail only — shown in collapsible section (own-view only)
  if (!ownerId) {
    declinedEvents = await query<CalEventRow>(
      attendeeBase + ` AND a.status = 'declined'`,
      [targetOwnerId, lastDay, firstDay]
    )
  }

  // Separate own events into templates, exceptions, and standalones
  const ownTemplates  = rawEvents.filter(e => e.recurrence !== 'none')
  const ownExceptions = rawEvents.filter(e => e.exception_date != null)
  const ownStandalones = rawEvents.filter(e => e.recurrence === 'none' && e.exception_date == null)

  // Build exclusion map: recurrence_id → set of exception dates (skip these in series expansion)
  const exclusionMap: Record<string, Set<string>> = {}
  for (const exc of ownExceptions) {
    if (exc.recurrence_id && exc.exception_date) {
      exclusionMap[exc.recurrence_id] ??= new Set()
      exclusionMap[exc.recurrence_id].add(exc.exception_date)
    }
  }

  // Expand recurring events
  const expanded: CalEventRow[] = []

  // Own templates: expand with exception exclusions
  for (const ev of ownTemplates) {
    const excDates = exclusionMap[ev.recurrence_id ?? ''] ?? new Set()
    expanded.push(...expandRecurring(ev, firstDay, lastDay, excDates))
  }

  // Invited events: expand without exception handling
  for (const ev of invitedEvents) {
    expanded.push(...expandRecurring(ev, firstDay, lastDay))
  }

  // Own standalones and non-cancelled exception overrides
  for (const ev of [...ownStandalones, ...ownExceptions.filter(e => !e.is_cancelled)]) {
    expanded.push(ev)
  }

  // Batch-fetch attendees for all event IDs (main + declined)
  const allSeedIds = [...new Set([...rawEvents, ...invitedEvents, ...declinedEvents].map(e => e.id))]
  let attendeeMap: Record<string, AttendeeRow[]> = {}
  let attachmentMap: Record<string, AttachmentRow[]> = {}

  if (allSeedIds.length > 0) {
    const attendees = await query<{ event_id: string; user_id: string; full_name: string; status: string }>(`
      SELECT a.event_id::text, a.user_id::text, u.full_name, a.status
      FROM calendar_event_attendees a
      JOIN users u ON u.id = a.user_id
      WHERE a.event_id = ANY($1::uuid[])
    `, [allSeedIds])
    for (const row of attendees) {
      if (!attendeeMap[row.event_id]) attendeeMap[row.event_id] = []
      attendeeMap[row.event_id].push({ user_id: row.user_id, full_name: row.full_name, status: row.status })
    }

    const attachments = await query<AttachmentRow & { event_id: string }>(`
      SELECT id::text, event_id::text, s3_key, filename, content_type
      FROM calendar_event_attachments
      WHERE event_id = ANY($1::uuid[])
    `, [allSeedIds])
    for (const row of attachments) {
      if (!attachmentMap[row.event_id]) attachmentMap[row.event_id] = []
      attachmentMap[row.event_id].push({ id: row.id, s3_key: row.s3_key, filename: row.filename, content_type: row.content_type })
    }
  }

  // Merge main events
  const events = expanded.map(ev => ({
    ...ev,
    attendees:   attendeeMap[ev.id]   ?? [],
    attachments: attachmentMap[ev.id] ?? [],
  }))

  // Merge declined events (flat, no recurrence expansion needed for audit trail)
  const declined = declinedEvents.map(ev => ({
    ...ev,
    attendees:   attendeeMap[ev.id]   ?? [],
    attachments: attachmentMap[ev.id] ?? [],
  }))

  return NextResponse.json({ events, declinedEvents: declined })
}

// ── POST /api/calendar ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !CAN_ACCESS.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTables() } catch {}

  const {
    title, category, startDate, startTime, endDate, endTime,
    allDay, location, notes, recurrence, ownerId,
    attendeeIds, reminderMinutes, taskId,
  } = await req.json()

  if (!title?.trim() || !startDate || !endDate) {
    return NextResponse.json({ error: 'title, startDate, and endDate are required' }, { status: 400 })
  }
  if (endDate < startDate) {
    return NextResponse.json({ error: 'End date must be on or after start date' }, { status: 400 })
  }

  // Determine who owns this event
  let calendarOwner = session.id
  if (ownerId && ownerId !== session.id) {
    if (!CAN_VIEW_TEAM.includes(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    calendarOwner = ownerId
  } else if (!HAS_OWN_CALENDAR.includes(session.role) && !ownerId) {
    return NextResponse.json({ error: 'Your role does not have a personal calendar. Specify ownerId.' }, { status: 400 })
  }

  const validRecurrences = ['none', 'daily', 'weekly', 'biweekly', 'monthly']
  const finalRecurrence = validRecurrences.includes(recurrence) ? recurrence : 'none'
  const recurrenceId    = finalRecurrence !== 'none' ? crypto.randomUUID() : null

  const result = await queryOne<{ id: string }>(`
    INSERT INTO calendar_events
      (title, category, start_date, start_time, end_date, end_time,
       all_day, location, notes, recurrence, recurrence_id,
       calendar_owner_id, task_id, created_by, created_by_name)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING id
  `, [
    title.trim(), category || 'other', startDate, startTime || null, endDate, endTime || null,
    !!allDay, location?.trim() || null, notes?.trim() || null,
    finalRecurrence, recurrenceId,
    calendarOwner, taskId || null, session.id, session.fullName,
  ])

  const eventId = result?.id
  if (!eventId) return NextResponse.json({ error: 'Insert failed' }, { status: 500 })

  // Insert attendees and send invites
  const inviteeIds: string[] = Array.isArray(attendeeIds) ? attendeeIds.filter((id: string) => id !== calendarOwner && id !== session.id) : []
  if (inviteeIds.length > 0) {
    try {
      for (const uid of inviteeIds) {
        await query(`
          INSERT INTO calendar_event_attendees (event_id, user_id, status)
          VALUES ($1, $2, 'invited')
          ON CONFLICT DO NOTHING
        `, [eventId, uid])
      }
    } catch (e) {
      console.error('Failed to insert calendar attendees:', e)
      // Don't fail the whole request — event was created; attendees can be added via edit
    }
    sendPushToUsers(inviteeIds, `Calendar Invite: ${title.trim()}`,
      `${session.fullName} invited you to "${title.trim()}" on ${startDate}.`,
      'calendar_invite'
    ).catch(() => {})
  }

  // Also notify the calendar owner if someone else added to their calendar
  if (calendarOwner !== session.id) {
    sendPushToUser(calendarOwner, `Event Added to Your Calendar`,
      `${session.fullName} added "${title.trim()}" on ${startDate}.`,
      'calendar_event'
    ).catch(() => {})
  }

  // Schedule reminders
  const minutes: number[] = Array.isArray(reminderMinutes) ? reminderMinutes : []
  if (minutes.length > 0 && startDate && (startTime || allDay)) {
    const eventDateTime = allDay
      ? new Date(startDate + 'T09:00:00-06:00')
      : new Date(`${startDate}T${startTime}:00-06:00`)

    for (const min of minutes) {
      if (typeof min !== 'number') continue
      const remindAt = new Date(eventDateTime.getTime() - min * 60_000)
      if (remindAt > new Date()) {
        await query(`
          INSERT INTO calendar_reminders (event_id, user_id, remind_at)
          VALUES ($1, $2, $3)
        `, [eventId, calendarOwner, remindAt.toISOString()])
      }
    }
    // Also schedule reminders for attendees
    for (const uid of inviteeIds) {
      for (const min of minutes) {
        if (typeof min !== 'number') continue
        const remindAt = new Date(
          (allDay ? new Date(startDate + 'T09:00:00-06:00') : new Date(`${startDate}T${startTime}:00-06:00`)).getTime() - min * 60_000
        )
        if (remindAt > new Date()) {
          await query(`
            INSERT INTO calendar_reminders (event_id, user_id, remind_at)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING
          `, [eventId, uid, remindAt.toISOString()])
        }
      }
    }
  }

  return NextResponse.json({ ok: true, id: eventId })
}

// ── PATCH /api/calendar ────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !CAN_ACCESS.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const {
    id, title, category, startDate, startTime, endDate, endTime,
    allDay, location, notes, recurrence, attendeeIds, reminderMinutes,
    editScope, instanceDate,
  } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Verify permission to edit
  const existing = await queryOne<{ calendar_owner_id: string; created_by: string; task_id: string | null }>(
    `SELECT calendar_owner_id::text, created_by::text, task_id::text FROM calendar_events WHERE id = $1`, [id]
  )
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwnerOfCalendar = existing.calendar_owner_id === session.id
  const isCreator         = existing.created_by === session.id
  const isElevated        = CAN_VIEW_TEAM.includes(session.role)
  if (!isOwnerOfCalendar && !isCreator && !isElevated) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (startDate && endDate && endDate < startDate) {
    return NextResponse.json({ error: 'End date must be on or after start date' }, { status: 400 })
  }

  // ── Edit this instance only ───────────────────────────────────────────────
  if (editScope === 'this' && instanceDate) {
    const seriesRow = await queryOne<{
      recurrence_id: string | null; recurrence: string
      title: string; category: string; start_date: string; end_date: string
      start_time: string | null; end_time: string | null; all_day: boolean
      location: string | null; notes: string | null; calendar_owner_id: string
    }>(`SELECT recurrence_id::text, recurrence, title, category,
               start_date::text, end_date::text, start_time::text, end_time::text,
               all_day, location, notes, calendar_owner_id::text
        FROM calendar_events WHERE id = $1`, [id])

    if (seriesRow && seriesRow.recurrence !== 'none' && seriesRow.recurrence_id) {
      // Preserve original event duration for the exception row
      const durationMs = Math.max(0,
        new Date(seriesRow.end_date + 'T12:00:00Z').getTime() - new Date(seriesRow.start_date + 'T12:00:00Z').getTime()
      )
      const instStart = new Date(instanceDate + 'T12:00:00Z')
      const defaultEndDate = new Date(instStart.getTime() + durationMs).toISOString().split('T')[0]
      const exceptionEndDate = endDate ?? defaultEndDate

      // Check if an exception row already exists for this date
      const existingExc = await queryOne<{ id: string }>(
        `SELECT id FROM calendar_events WHERE recurrence_id = $1 AND exception_date = $2`,
        [seriesRow.recurrence_id, instanceDate]
      )

      if (existingExc) {
        await query(`
          UPDATE calendar_events SET
            title      = COALESCE($1, title),
            category   = COALESCE($2, category),
            start_date = COALESCE($3, start_date),
            start_time = CASE WHEN $4::text IS NOT NULL THEN $4::time ELSE start_time END,
            end_date   = COALESCE($5, end_date),
            end_time   = CASE WHEN $6::text IS NOT NULL THEN $6::time ELSE end_time END,
            all_day    = COALESCE($7, all_day),
            location   = COALESCE($8, location),
            notes      = COALESCE($9, notes),
            is_cancelled = FALSE,
            updated_at = NOW()
          WHERE id = $10
        `, [title?.trim() ?? null, category ?? null, startDate ?? null, startTime ?? null,
            exceptionEndDate, endTime ?? null, allDay ?? null,
            location?.trim() ?? null, notes?.trim() ?? null, existingExc.id])
      } else {
        await query(`
          INSERT INTO calendar_events
            (title, category, start_date, start_time, end_date, end_time,
             all_day, location, notes, recurrence, recurrence_id,
             calendar_owner_id, created_by, created_by_name, exception_date)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'none',$10,$11,$12,$13,$14)
        `, [
          title?.trim() ?? seriesRow.title,
          category ?? seriesRow.category,
          startDate ?? instanceDate,
          startTime !== undefined ? (startTime || null) : seriesRow.start_time,
          exceptionEndDate,
          endTime !== undefined ? (endTime || null) : seriesRow.end_time,
          allDay !== undefined ? allDay : seriesRow.all_day,
          location !== undefined ? (location?.trim() || null) : seriesRow.location,
          notes !== undefined ? (notes?.trim() || null) : seriesRow.notes,
          seriesRow.recurrence_id,
          seriesRow.calendar_owner_id,
          session.id, session.fullName,
          instanceDate,
        ])
      }
      return NextResponse.json({ ok: true })
    }
  }

  const validRecurrences = ['none', 'daily', 'weekly', 'biweekly', 'monthly']
  const finalRecurrence = recurrence !== undefined
    ? (validRecurrences.includes(recurrence) ? recurrence : 'none')
    : undefined

  await query(`
    UPDATE calendar_events SET
      title      = COALESCE($1, title),
      category   = COALESCE($2, category),
      start_date = COALESCE($3, start_date),
      start_time = CASE WHEN $4::text IS NOT NULL THEN $4::time ELSE start_time END,
      end_date   = COALESCE($5, end_date),
      end_time   = CASE WHEN $6::text IS NOT NULL THEN $6::time ELSE end_time END,
      all_day    = COALESCE($7, all_day),
      location   = COALESCE($8, location),
      notes      = COALESCE($9, notes),
      recurrence = COALESCE($10, recurrence),
      updated_at = NOW()
    WHERE id = $11
  `, [
    title?.trim() ?? null,
    category ?? null,
    startDate ?? null,
    startTime ?? null,
    endDate ?? null,
    endTime ?? null,
    allDay ?? null,
    location?.trim() ?? null,
    notes?.trim() ?? null,
    finalRecurrence ?? null,
    id,
  ])

  // Update attendees if provided
  if (Array.isArray(attendeeIds)) {
    const currentAttendees = await query<{ user_id: string }>(
      `SELECT user_id::text FROM calendar_event_attendees WHERE event_id = $1`, [id]
    )
    const currentIds = new Set(currentAttendees.map(r => r.user_id))
    const newIds = new Set(attendeeIds.filter((uid: string) => uid !== session.id))

    // Add new attendees
    const toAdd = [...newIds].filter(uid => !currentIds.has(uid))
    for (const uid of toAdd) {
      await query(`
        INSERT INTO calendar_event_attendees (event_id, user_id, status)
        VALUES ($1, $2, 'invited')
        ON CONFLICT DO NOTHING
      `, [id, uid])
    }
    if (toAdd.length > 0) {
      const evTitle = title ?? 'a calendar event'
      sendPushToUsers(toAdd, `Calendar Invite: ${evTitle}`,
        `${session.fullName} invited you to "${evTitle}".`,
        'calendar_invite'
      ).catch(() => {})
    }

    // Remove removed attendees
    const toRemove = [...currentIds].filter(uid => !newIds.has(uid))
    for (const uid of toRemove) {
      await query(`DELETE FROM calendar_event_attendees WHERE event_id = $1 AND user_id = $2`, [id, uid])
    }
  }

  // Reschedule reminders if time changed
  if (Array.isArray(reminderMinutes) && (startDate || startTime)) {
    await query(`DELETE FROM calendar_reminders WHERE event_id = $1`, [id])
    const updated = await queryOne<{ start_date: string; start_time: string | null; all_day: boolean; calendar_owner_id: string }>(
      `SELECT start_date::text, start_time::text, all_day, calendar_owner_id::text FROM calendar_events WHERE id = $1`, [id]
    )
    if (updated) {
      const eventDateTime = updated.all_day
        ? new Date(updated.start_date + 'T09:00:00-06:00')
        : new Date(`${updated.start_date}T${updated.start_time}:00-06:00`)
      for (const min of reminderMinutes) {
        if (typeof min !== 'number') continue
        const remindAt = new Date(eventDateTime.getTime() - min * 60_000)
        if (remindAt > new Date()) {
          await query(`INSERT INTO calendar_reminders (event_id, user_id, remind_at) VALUES ($1,$2,$3)`,
            [id, updated.calendar_owner_id, remindAt.toISOString()])
        }
      }
    }
  }

  return NextResponse.json({ ok: true })
}

// ── DELETE /api/calendar ──────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !CAN_ACCESS.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, deleteScope, instanceDate } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = await queryOne<{
    calendar_owner_id: string; created_by: string
    recurrence_id: string | null; recurrence: string
    title: string; category: string; start_date: string; end_date: string
  }>(
    `SELECT calendar_owner_id::text, created_by::text, recurrence_id::text, recurrence,
            title, category, start_date::text, end_date::text
     FROM calendar_events WHERE id = $1`, [id]
  )
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwnerOfCalendar = existing.calendar_owner_id === session.id
  const isCreator         = existing.created_by === session.id
  const isElevated        = CAN_VIEW_TEAM.includes(session.role)
  if (!isOwnerOfCalendar && !isCreator && !isElevated) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Delete this instance only ─────────────────────────────────────────────
  if (deleteScope === 'this' && instanceDate && existing.recurrence !== 'none' && existing.recurrence_id) {
    const durationMs = Math.max(0,
      new Date(existing.end_date + 'T12:00:00Z').getTime() - new Date(existing.start_date + 'T12:00:00Z').getTime()
    )
    const exceptionEndDate = new Date(new Date(instanceDate + 'T12:00:00Z').getTime() + durationMs).toISOString().split('T')[0]

    const existingExc = await queryOne<{ id: string }>(
      `SELECT id FROM calendar_events WHERE recurrence_id = $1 AND exception_date = $2`,
      [existing.recurrence_id, instanceDate]
    )

    if (existingExc) {
      await query(`UPDATE calendar_events SET is_cancelled = TRUE WHERE id = $1`, [existingExc.id])
    } else {
      await query(`
        INSERT INTO calendar_events
          (title, category, start_date, end_date, all_day, recurrence, recurrence_id,
           calendar_owner_id, created_by, created_by_name, exception_date, is_cancelled)
        VALUES ($1,$2,$3,$4,FALSE,'none',$5,$6,$7,$8,$9,TRUE)
      `, [existing.title, existing.category, instanceDate, exceptionEndDate,
          existing.recurrence_id, existing.calendar_owner_id, session.id, session.fullName, instanceDate])
    }
    return NextResponse.json({ ok: true })
  }

  // ── Delete all: clean up exception rows first, then delete the series ─────
  if (existing.recurrence_id && existing.recurrence !== 'none') {
    await query(`DELETE FROM calendar_events WHERE recurrence_id = $1 AND exception_date IS NOT NULL`, [existing.recurrence_id])
  }

  // Cascade deletes attendees, reminders, attachments via FK ON DELETE CASCADE
  await query(`DELETE FROM calendar_events WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
