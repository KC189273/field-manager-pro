import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const CST = 'America/Chicago'
const ALLOWED_ROLES = ['ops_manager', 'owner', 'sales_director', 'developer']

// Payroll period anchor — same as payroll/route.ts
const ANCHOR = new Date(Date.UTC(2026, 2, 30, 12, 0, 0))

function getCurrentPeriod(): { start: string; end: string } {
  const now = new Date()
  const daysSince = Math.floor((now.getTime() - ANCHOR.getTime()) / 86400000)
  const idx = Math.floor(daysSince / 14)
  const start = new Date(ANCHOR)
  start.setUTCDate(start.getUTCDate() + idx * 14)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 13)
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
}

async function getOrgId(session: { id: string; org_id?: string | null }): Promise<string | null> {
  if (session.org_id) return session.org_id
  const row = await queryOne<{ org_id: string | null }>('SELECT org_id FROM users WHERE id = $1', [session.id])
  return row?.org_id ?? null
}

// GET /api/employee-record?employeeId=xxx&from=2026-08-01&to=2026-08-14
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const employeeId = searchParams.get('employeeId')

  // If no employeeId, return employee list for the selector
  if (!employeeId) {
    const orgId = await getOrgId(session)
    const orgFilter = orgId ? `AND u.org_id = $1` : ''
    const params = orgId ? [orgId] : []

    const employees = await query<{
      id: string; full_name: string; username: string; role: string
      manager_name: string | null; is_active: boolean; avatar_key: string | null
    }>(`
      SELECT u.id, u.full_name, u.username, u.role, u.is_active,
             u.avatar_key, m.full_name as manager_name
      FROM users u
      LEFT JOIN users m ON m.id = u.manager_id
      WHERE u.role IN ('employee', 'manager')
        ${orgFilter}
      ORDER BY u.full_name
    `, params)

    const period = getCurrentPeriod()
    return NextResponse.json({ employees, currentPeriod: period })
  }

  // Date range — default to current pay period
  const period = getCurrentPeriod()
  const from = searchParams.get('from') || period.start
  const to = searchParams.get('to') || period.end

  try {
  // Get employee info
  const emp = await queryOne<{
    id: string; full_name: string; username: string; email: string
    role: string; pay_type: string; created_at: string; manager_name: string | null
    is_active: boolean; is_terminated: boolean
  }>(`
    SELECT u.id, u.full_name, u.username, u.email, u.role, u.pay_type,
           u.created_at::text, u.is_active, COALESCE(u.is_terminated, FALSE) as is_terminated,
           m.full_name as manager_name
    FROM users u
    LEFT JOIN users m ON m.id = u.manager_id
    WHERE u.id = $1
  `, [employeeId])

  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

  // ── Shifts with breaks ──
  const shifts = await query<{
    id: string; clock_in_at: string; clock_out_at: string | null
    clock_in_lat: string | null; clock_in_lng: string | null
    clock_out_lat: string | null; clock_out_lng: string | null
    clock_in_address: string | null; clock_out_address: string | null
    is_manual: boolean; manual_note: string | null; manual_by_name: string | null
    store_address: string | null; break_minutes: number
    geofence_override: boolean; clock_in_photo_key: string | null
    duration_hours: number
  }>(`
    SELECT s.id, s.clock_in_at::text, s.clock_out_at::text,
           s.clock_in_lat::text, s.clock_in_lng::text,
           s.clock_out_lat::text, s.clock_out_lng::text,
           s.clock_in_address, s.clock_out_address,
           s.is_manual, s.manual_note,
           COALESCE(s.geofence_override, FALSE) as geofence_override,
           s.clock_in_photo_key,
           mb.full_name as manual_by_name,
           sl.address as store_address,
           COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start)) / 60)
                     FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)::int as break_minutes,
           CASE WHEN s.clock_out_at IS NOT NULL THEN
             ROUND((EXTRACT(EPOCH FROM (s.clock_out_at - s.clock_in_at)) / 3600.0
               - COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start)) / 3600.0)
                           FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0))::numeric, 2)::float
           ELSE 0 END as duration_hours
    FROM shifts s
    LEFT JOIN users mb ON mb.id = s.manual_by
    LEFT JOIN dm_store_locations sl ON sl.id = s.store_location_id
    WHERE s.user_id = $1
      AND (s.clock_in_at AT TIME ZONE $2)::date >= $3::date
      AND (s.clock_in_at AT TIME ZONE $2)::date <= $4::date
    ORDER BY s.clock_in_at ASC
  `, [employeeId, CST, from, to])

  // ── Shift edits ──
  const shiftIds = shifts.map(s => s.id)
  const edits = shiftIds.length > 0 ? await query<{
    shift_id: string; old_clock_in: string | null; new_clock_in: string | null
    old_clock_out: string | null; new_clock_out: string | null
    note: string | null; edited_by_name: string; edited_at: string
  }>(`
    SELECT se.shift_id, se.old_clock_in::text, se.new_clock_in::text,
           se.old_clock_out::text, se.new_clock_out::text,
           se.note, u.full_name as edited_by_name, se.edited_at::text
    FROM shift_edits se
    JOIN users u ON u.id = se.edited_by
    WHERE se.shift_id = ANY($1::uuid[])
    ORDER BY se.edited_at ASC
  `, [shiftIds]) : []

  // ── Accountability docs ──
  const accountability = await query<{
    id: string; ref_number: string; level: string; title: string
    incident_date: string; notes: string; expectations: string
    status: string; ack_status: string; author_name: string
    approved_at: string | null; created_at: string
  }>(`
    SELECT id, ref_number, level, title, incident_date::text,
           notes, expectations, status, ack_status,
           author_name, approved_at::text, created_at::text
    FROM accountability_docs
    WHERE subject_id = $1
      AND created_at::date >= $2::date
      AND created_at::date <= $3::date
    ORDER BY created_at ASC
  `, [employeeId, from, to])

  // ── Flags ──
  const flags = await query<{
    id: string; type: string; detail: string | null; date: string
    resolved: boolean; resolved_by_name: string | null; resolution_note: string | null
    created_at: string
  }>(`
    SELECT id, type, detail, date::text, resolved,
           resolved_by_name, resolution_note, created_at::text
    FROM flags
    WHERE user_id = $1
      AND created_at::date >= $2::date
      AND created_at::date <= $3::date
    ORDER BY created_at ASC
  `, [employeeId, from, to])

  // ── Geofence overrides ──
  const overrides = await query<{
    id: string; approved_by_name: string; store_address: string | null
    reason: string; reported_distance_ft: number | null; created_at: string
  }>(`
    SELECT id, approved_by_name, store_address, reason,
           reported_distance_ft, created_at::text
    FROM geofence_overrides
    WHERE employee_id = $1
      AND created_at::date >= $2::date
      AND created_at::date <= $3::date
    ORDER BY created_at ASC
  `, [employeeId, from, to]).catch(() => [] as Array<{ id: string; approved_by_name: string; store_address: string | null; reason: string; reported_distance_ft: number | null; created_at: string }>)

  // ── Time-off requests ──
  const timeOff = await query<{
    id: string; start_date: string; end_date: string; reason: string | null
    status: string; notes: string | null; approver_name: string | null
    partial_day: boolean; partial_start_time: string | null; partial_end_time: string | null
    created_at: string
  }>(`
    SELECT tor.id, tor.start_date::text, tor.end_date::text, tor.reason,
           tor.status, tor.notes, tor.created_at::text,
           tor.partial_day, tor.partial_start_time::text, tor.partial_end_time::text,
           a.full_name as approver_name
    FROM time_off_requests tor
    LEFT JOIN users a ON a.id = tor.approver_id
    WHERE tor.user_id = $1
      AND tor.start_date <= $2::date
      AND tor.end_date >= $3::date
    ORDER BY tor.start_date ASC
  `, [employeeId, to, from])

  // ── Summary stats ──
  const totalHours = shifts.reduce((sum, s) => sum + (s.duration_hours || 0), 0)
  const totalBreakMin = shifts.reduce((sum, s) => sum + s.break_minutes, 0)
  const manualEntries = shifts.filter(s => s.is_manual).length
  const editedShifts = new Set(edits.map(e => e.shift_id)).size
  const gpsVerified = shifts.filter(s => s.clock_in_lat).length

  return NextResponse.json({
    employee: emp,
    period: { from, to },
    currentPeriod: period,
    summary: {
      totalShifts: shifts.length,
      totalHours: Math.round(totalHours * 100) / 100,
      totalBreakMinutes: totalBreakMin,
      manualEntries,
      editedShifts,
      gpsVerified,
      flagCount: flags.length,
      accountabilityCount: accountability.length,
      overrideCount: overrides.length,
    },
    shifts,
    edits,
    accountability,
    flags,
    overrides,
    timeOff,
  })
  } catch (err) {
    console.error('Employee record error:', err)
    return NextResponse.json({ error: 'Failed to load record: ' + String(err) }, { status: 500 })
  }
}
