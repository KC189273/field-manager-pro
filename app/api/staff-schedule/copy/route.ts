import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

let ensured = false
async function ensureScheduledShiftsColumns() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE scheduled_shifts ALTER COLUMN employee_id DROP NOT NULL`).catch(() => {})
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { storeId, targetWeekStart } = await req.json()
  if (!storeId || !targetWeekStart) {
    return NextResponse.json({ error: 'storeId and targetWeekStart required' }, { status: 400 })
  }

  // Managers must own the store
  if (session.role === 'manager') {
    const access = await queryOne(
      `SELECT 1 FROM dm_manager_stores WHERE manager_id = $1 AND store_location_id = $2`,
      [session.id, storeId]
    )
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Allow employee_id to be null (idempotent)
  try { await ensureScheduledShiftsColumns() } catch {}

  // Compute target week end
  const targetEnd = new Date(targetWeekStart + 'T12:00:00')
  targetEnd.setDate(targetEnd.getDate() + 6)
  const targetWeekEnd = targetEnd.toISOString().split('T')[0]

  // Block if target week already has shifts
  const existing = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM scheduled_shifts WHERE store_location_id = $1 AND shift_date >= $2 AND shift_date <= $3`,
    [storeId, targetWeekStart, targetWeekEnd]
  )
  if (parseInt(existing?.count ?? '0') > 0) {
    return NextResponse.json({ error: 'This week already has shifts. Remove them first before copying.' }, { status: 400 })
  }

  // Derive source week (7 days before target)
  const sourceStart = new Date(targetWeekStart + 'T12:00:00')
  sourceStart.setDate(sourceStart.getDate() - 7)
  const sourceWeekStart = sourceStart.toISOString().split('T')[0]
  const sourceEnd = new Date(sourceStart)
  sourceEnd.setDate(sourceEnd.getDate() + 6)
  const sourceWeekEnd = sourceEnd.toISOString().split('T')[0]

  // Fetch previous week's shifts
  const sourceShifts = await query<{
    shift_date: string
    start_time: string
    end_time: string
    role_note: string | null
    break_minutes: number
    is_on_call: boolean
    org_id: string | null
  }>(
    `SELECT shift_date::text, start_time::text, end_time::text,
            role_note, COALESCE(break_minutes, 0) AS break_minutes,
            COALESCE(is_on_call, FALSE) AS is_on_call, org_id
     FROM scheduled_shifts
     WHERE store_location_id = $1 AND shift_date >= $2 AND shift_date <= $3
     ORDER BY shift_date, start_time`,
    [storeId, sourceWeekStart, sourceWeekEnd]
  )

  if (sourceShifts.length === 0) {
    return NextResponse.json({ error: 'No shifts found in the previous week to copy.' }, { status: 400 })
  }

  // Insert copies with NULL employee_id, dates shifted forward 7 days
  for (const s of sourceShifts) {
    const d = new Date(s.shift_date + 'T12:00:00')
    d.setDate(d.getDate() + 7)
    const newDate = d.toISOString().split('T')[0]

    await query(
      `INSERT INTO scheduled_shifts
         (org_id, store_location_id, shift_date, start_time, end_time, role_note, created_by, break_minutes, is_on_call)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [s.org_id, storeId, newDate, s.start_time, s.end_time, s.role_note, session.id, s.break_minutes, s.is_on_call]
    )
  }

  return NextResponse.json({ ok: true, count: sourceShifts.length })
}
