import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUsers } from '@/lib/apns'

const ALLOWED = ['sales_director', 'owner', 'developer']

const CAT_LABELS: Record<string, string> = {
  travel: 'Travel', meeting: 'Meeting', store_visit: 'Store Visit', blocked: 'Blocked', other: 'Event',
}

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title           TEXT NOT NULL,
      category        TEXT NOT NULL DEFAULT 'other',
      start_date      DATE NOT NULL,
      start_time      TIME,
      end_date        DATE NOT NULL,
      end_time        TIME,
      notes           TEXT,
      created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT,
      org_id          UUID,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

// GET /api/calendar?year=2026&month=5
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTable() } catch {}

  const { searchParams } = new URL(req.url)
  const year  = parseInt(searchParams.get('year')  ?? String(new Date().getFullYear()))
  const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1))

  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay  = new Date(year, month, 0).toISOString().split('T')[0] // last day of month

  const events = await query<{
    id: string
    title: string
    category: string
    start_date: string
    start_time: string | null
    end_date: string
    end_time: string | null
    notes: string | null
    created_by: string | null
    created_by_name: string | null
    created_at: string
  }>(
    `SELECT id, title, category,
            start_date::text, start_time::text,
            end_date::text,   end_time::text,
            notes, created_by, created_by_name, created_at::text
     FROM calendar_events
     WHERE start_date <= $1 AND end_date >= $2
     ORDER BY start_date, start_time NULLS LAST`,
    [lastDay, firstDay]
  )

  return NextResponse.json({ events })
}

// POST /api/calendar — create
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTable() } catch {}

  const { title, category, startDate, startTime, endDate, endTime, notes } = await req.json()
  if (!title?.trim() || !startDate || !endDate) {
    return NextResponse.json({ error: 'title, startDate, and endDate are required' }, { status: 400 })
  }
  if (endDate < startDate) {
    return NextResponse.json({ error: 'End date must be on or after start date' }, { status: 400 })
  }

  const result = await queryOne<{ id: string }>(
    `INSERT INTO calendar_events
       (title, category, start_date, start_time, end_date, end_time, notes, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [title.trim(), category || 'other', startDate, startTime || null, endDate, endTime || null, notes?.trim() || null, session.id, session.fullName]
  )

  // Notify all other SD/Owner/Dev users
  try {
    const recipients = await query<{ id: string }>(
      `SELECT id FROM users WHERE role IN ('sales_director', 'owner', 'developer') AND id != $1 AND is_active = TRUE`,
      [session.id]
    )
    if (recipients.length > 0) {
      const catLabel = CAT_LABELS[category || 'other'] ?? 'Event'
      sendPushToUsers(
        recipients.map(r => r.id),
        `New ${catLabel} Added`,
        `${session.fullName} added "${title.trim()}" to the calendar.`,
        'calendar_event'
      ).catch(() => {})
    }
  } catch {}

  return NextResponse.json({ ok: true, id: result?.id })
}

// PATCH /api/calendar — update
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, title, category, startDate, startTime, endDate, endTime, notes } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (startDate && endDate && endDate < startDate) {
    return NextResponse.json({ error: 'End date must be on or after start date' }, { status: 400 })
  }

  await query(
    `UPDATE calendar_events
     SET title      = COALESCE($1, title),
         category   = COALESCE($2, category),
         start_date = COALESCE($3, start_date),
         start_time = $4,
         end_date   = COALESCE($5, end_date),
         end_time   = $6,
         notes      = $7,
         updated_at = NOW()
     WHERE id = $8`,
    [title?.trim() ?? null, category ?? null, startDate ?? null, startTime || null, endDate ?? null, endTime || null, notes?.trim() || null, id]
  )

  return NextResponse.json({ ok: true })
}

// DELETE /api/calendar
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await query(`DELETE FROM calendar_events WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
