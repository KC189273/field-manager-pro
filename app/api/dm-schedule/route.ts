import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS dm_weekly_schedules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID,
      dm_id UUID NOT NULL,
      dm_name TEXT NOT NULL,
      week_start DATE NOT NULL,
      schedule JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(dm_id, week_start)
    )
  `)
}

const canViewAll = (role: string) =>
  role === 'sales_director' || role === 'owner' || role === 'developer'

function getWeekMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

// GET — fetch DM schedules for SD/owner/developer view
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try { await ensureTable() } catch {}

  const { searchParams } = new URL(req.url)
  const weekStart = searchParams.get('weekStart')
  const dmId = searchParams.get('dmId')
  const today = searchParams.get('today') === 'true'

  // ── Today view: all DMs and where they're working today ──
  if (today) {
    if (!canViewAll(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const orgFilter = await getOrgFilter(session)
    const params: unknown[] = []
    let orgWhere = ''
    if (orgFilter.filterByOrg && orgFilter.orgId) {
      params.push(orgFilter.orgId)
      orgWhere = ` AND u.org_id = $${params.length}`
    }

    // All active DMs
    const dms = await query<{ id: string; full_name: string }>(`
      SELECT id, full_name FROM users
      WHERE role = 'manager' AND is_active = TRUE AND (is_hidden = FALSE OR is_hidden IS NULL)${orgWhere}
      ORDER BY full_name
    `, params)

    // Today's DM shifts from scheduled_shifts
    const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
    const todayShifts = await query<{
      employee_id: string; shift_date: string; start_time: string; end_time: string
      store_address: string; role_note: string | null; is_dm_shift: boolean
    }>(`
      SELECT ss.employee_id, ss.shift_date::text, ss.start_time::text, ss.end_time::text,
        dsl.address AS store_address, ss.role_note, COALESCE(ss.is_dm_shift, FALSE) AS is_dm_shift
      FROM scheduled_shifts ss
      JOIN users u ON u.id = ss.employee_id
      JOIN dm_store_locations dsl ON dsl.id = ss.store_location_id
      WHERE u.role = 'manager' AND ss.shift_date = $1${orgWhere ? orgWhere.replace('u.org_id', 'u.org_id') : ''}
      ORDER BY ss.start_time
    `, [todayDate, ...(orgFilter.orgId ? [orgFilter.orgId] : [])])

    // Today's notes from dm_weekly_schedules
    const todayWeekStart = getWeekMonday(todayDate)
    const todayDayIdx = (new Date(todayDate + 'T12:00:00').getDay() + 6) % 7 // Mon=0 ... Sun=6
    const weeklyNotes = await query<{ dm_id: string; schedule: string }>(`
      SELECT dm_id, schedule::text FROM dm_weekly_schedules
      WHERE week_start = $1
    `, [todayWeekStart])

    const notesByDm = new Map<string, { store_address: string; reason: string }[]>()
    for (const wn of weeklyNotes) {
      try {
        const sched = JSON.parse(wn.schedule)
        const day = sched[todayDayIdx]
        if (day?.working && day.locations?.length > 0) {
          notesByDm.set(wn.dm_id, day.locations)
        }
      } catch {}
    }

    const todaySchedule = dms.map(dm => {
      const shifts = todayShifts.filter(s => s.employee_id === dm.id)
      const notes = notesByDm.get(dm.id) ?? []
      return {
        dm_id: dm.id,
        dm_name: dm.full_name,
        shifts: shifts.map(s => ({
          start_time: s.start_time,
          end_time: s.end_time,
          store_address: s.store_address,
          role_note: s.role_note,
        })),
        visit_notes: notes.map(n => ({
          store_address: n.store_address,
          reason: n.reason,
        })),
        working: shifts.length > 0 || notes.length > 0,
      }
    })

    return NextResponse.json({ today: todaySchedule, date: todayDate })
  }

  // ── Weekly view: DM shifts + notes for a week ──
  if (!weekStart) return NextResponse.json({ error: 'weekStart required' }, { status: 400 })

  const orgFilter = await getOrgFilter(session)

  // For DMs viewing their own (kept for backward compatibility)
  if (!canViewAll(session.role)) {
    const params: unknown[] = [weekStart, session.id]
    const schedules = await query<{ id: string; dm_id: string; dm_name: string; week_start: string; schedule: string; updated_at: string }>(`
      SELECT s.id, s.dm_id, s.dm_name, s.week_start::text, s.schedule::text, s.updated_at::text
      FROM dm_weekly_schedules s WHERE s.week_start = $1 AND s.dm_id = $2
    `, params)
    return NextResponse.json({ schedules: schedules.map(s => ({ ...s, schedule: JSON.parse(s.schedule) })) })
  }

  // SD/owner/developer: get all DMs
  const orgParams: unknown[] = []
  let orgWhere = ''
  if (orgFilter.filterByOrg && orgFilter.orgId) {
    orgParams.push(orgFilter.orgId)
    orgWhere = ` AND u.org_id = $${orgParams.length}`
  }

  const dms = await query<{ id: string; full_name: string }>(`
    SELECT id, full_name FROM users
    WHERE role = 'manager' AND is_active = TRUE AND (is_hidden = FALSE OR is_hidden IS NULL)${orgWhere}
    ORDER BY full_name
  `, orgParams)

  const weekEnd = new Date(weekStart + 'T12:00:00')
  weekEnd.setDate(weekEnd.getDate() + 6)
  const weekEndStr = weekEnd.toISOString().split('T')[0]

  // Get DM shifts for the week
  const shifts = await query<{
    employee_id: string; shift_date: string; start_time: string; end_time: string
    store_address: string; role_note: string | null
  }>(`
    SELECT ss.employee_id, ss.shift_date::text, ss.start_time::text, ss.end_time::text,
      dsl.address AS store_address, ss.role_note
    FROM scheduled_shifts ss
    JOIN users u ON u.id = ss.employee_id
    JOIN dm_store_locations dsl ON dsl.id = ss.store_location_id
    WHERE u.role = 'manager' AND ss.shift_date >= $1 AND ss.shift_date <= $2${orgWhere}
    ORDER BY ss.shift_date, ss.start_time
  `, [weekStart, weekEndStr, ...(orgFilter.orgId ? [orgFilter.orgId] : [])])

  // Get visit notes from dm_weekly_schedules
  const weeklyNotes = await query<{ dm_id: string; dm_name: string; schedule: string; updated_at: string }>(`
    SELECT dm_id, dm_name, schedule::text, updated_at::text FROM dm_weekly_schedules
    WHERE week_start = $1${orgFilter.orgId ? ` AND org_id = $2` : ''}
  `, [weekStart, ...(orgFilter.orgId ? [orgFilter.orgId] : [])])

  const notesByDm = new Map<string, { schedule: unknown[]; updated_at: string }>()
  for (const wn of weeklyNotes) {
    try { notesByDm.set(wn.dm_id, { schedule: JSON.parse(wn.schedule), updated_at: wn.updated_at }) } catch {}
  }

  // Build per-DM schedule with merged data
  const dmSchedules = dms
    .filter(dm => !dmId || dm.id === dmId)
    .map(dm => {
      const dmShifts = shifts.filter(s => s.employee_id === dm.id)
      const notes = notesByDm.get(dm.id)

      // Build 7-day view (Mon-Sun)
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart + 'T12:00:00')
        d.setDate(d.getDate() + i)
        const dateStr = d.toISOString().split('T')[0]
        const dayShifts = dmShifts.filter(s => s.shift_date === dateStr)
        const dayNotes = notes?.schedule?.[i] as { working?: boolean; locations?: { store_address: string; reason: string }[] } | undefined

        return {
          date: dateStr,
          day_index: i,
          shifts: dayShifts.map(s => ({
            start_time: s.start_time,
            end_time: s.end_time,
            store_address: s.store_address,
            role_note: s.role_note,
          })),
          visit_notes: (dayNotes?.locations ?? []).filter(l => l.store_address || l.reason),
          working: dayShifts.length > 0 || (dayNotes?.working ?? false),
        }
      })

      return {
        dm_id: dm.id,
        dm_name: dm.full_name,
        has_shifts: dmShifts.length > 0,
        has_notes: !!notes,
        notes_updated_at: notes?.updated_at ?? null,
        days,
      }
    })

  return NextResponse.json({ dmSchedules, dms })
}

// POST — save/update a DM's weekly schedule (kept for backward compat)
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'manager' && session.role !== 'developer') {
    return NextResponse.json({ error: 'Only DMs can submit schedules' }, { status: 403 })
  }

  try { await ensureTable() } catch {}

  const { weekStart, schedule } = await req.json()
  if (!weekStart || !Array.isArray(schedule)) {
    return NextResponse.json({ error: 'weekStart and schedule array required' }, { status: 400 })
  }

  const [row] = await query<{ id: string }>(`
    INSERT INTO dm_weekly_schedules (org_id, dm_id, dm_name, week_start, schedule)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (dm_id, week_start) DO UPDATE SET
      schedule = $5, dm_name = $3, updated_at = NOW()
    RETURNING id
  `, [session.org_id ?? null, session.id, session.fullName, weekStart, JSON.stringify(schedule)])

  return NextResponse.json({ ok: true, id: row.id })
}
