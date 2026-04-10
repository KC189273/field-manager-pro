import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager, isOwner, type Role } from '@/lib/auth'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'

const canManageShifts = (role: Role) => isManager(role) || isOwner(role) || role === 'developer'
import { query } from '@/lib/db'
import { sendEmail, manualTimeEntryHtml } from '@/lib/notifications'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const team = searchParams.get('team') === 'true'

  // Team view: all employees reporting to this manager/owner/developer
  if (team) {
    if (!canManageShifts(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const params: unknown[] = []
    let sql = `
      SELECT s.*, u.full_name, u.username,
        mb.full_name as manual_by_name,
        EXTRACT(EPOCH FROM (COALESCE(s.clock_out_at, NOW()) - s.clock_in_at)) as duration_seconds
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN users mb ON mb.id = s.manual_by
      WHERE u.role != 'developer'
    `

    if (isManager(session.role)) {
      params.push(session.id)
      sql += ` AND u.manager_id = $${params.length}`
    } else {
      const orgFilter = await getOrgFilter(session)
      sql += appendOrgFilter(orgFilter, params, 'u')
    }

    if (from) { params.push(from); sql += ` AND s.clock_in_at >= $${params.length}` }
    if (to) { params.push(to); sql += ` AND s.clock_in_at <= $${params.length}` }
    sql += ` ORDER BY u.full_name, s.clock_in_at`

    const shifts = await query(sql, params)
    return NextResponse.json({ shifts })
  }

  const userId = searchParams.get('userId') ?? session.id

  if (userId !== session.id && !canManageShifts(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let sql = `
    SELECT s.*, u.full_name, u.username,
      mb.full_name as manual_by_name,
      EXTRACT(EPOCH FROM (COALESCE(s.clock_out_at, NOW()) - s.clock_in_at)) as duration_seconds
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN users mb ON mb.id = s.manual_by
    WHERE s.user_id = $1
  `
  const params: unknown[] = [userId]

  if (from) { params.push(from); sql += ` AND s.clock_in_at >= $${params.length}` }
  if (to) { params.push(to); sql += ` AND s.clock_in_at <= $${params.length}` }
  sql += ` ORDER BY s.clock_in_at DESC LIMIT 50`

  const shifts = await query(sql, params)
  return NextResponse.json({ shifts })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManageShifts(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId, clockIn, clockOut, note } = await req.json()
  if (!userId || !clockIn || !note) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

  const employee = await query<{ id: string; full_name: string; email: string }>(
    `SELECT id, full_name, email FROM users WHERE id = $1`, [userId]
  )
  if (!employee[0]) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  await query(
    `INSERT INTO shifts (user_id, clock_in_at, clock_out_at, is_manual, manual_note, manual_by)
     VALUES ($1, $2, $3, TRUE, $4, $5)`,
    [userId, clockIn, clockOut ?? null, note, session.id]
  )

  // Notify employee
  const clockInStr = new Date(clockIn).toLocaleString('en-US', { timeZone: 'America/Chicago' })
  const clockOutStr = clockOut ? new Date(clockOut).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : 'Not set'
  const date = new Date(clockIn).toLocaleDateString('en-US', { timeZone: 'America/Chicago' })

  await sendEmail(
    employee[0].email,
    `FMP: Your time entry was adjusted — ${date}`,
    manualTimeEntryHtml(employee[0].full_name, date, clockInStr, clockOutStr, note, session.fullName)
  )

  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManageShifts(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { shiftId, clockIn, clockOut, note } = await req.json()
  if (!shiftId || !note) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

  const shift = await query<{ user_id: string }>(
    `UPDATE shifts SET clock_in_at = COALESCE($1, clock_in_at), clock_out_at = $2,
     is_manual = TRUE, manual_note = $3, manual_by = $4
     WHERE id = $5 RETURNING user_id`,
    [clockIn ?? null, clockOut ?? null, note, session.id, shiftId]
  )
  if (!shift[0]) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })

  const employee = await query<{ full_name: string; email: string }>(
    `SELECT full_name, email FROM users WHERE id = $1`, [shift[0].user_id]
  )
  if (employee[0]) {
    const date = clockIn ? new Date(clockIn).toLocaleDateString('en-US', { timeZone: 'America/Chicago' }) : 'Unknown'
    const inStr = clockIn ? new Date(clockIn).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : 'Unchanged'
    const outStr = clockOut ? new Date(clockOut).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : 'Not set'
    await sendEmail(
      employee[0].email,
      `FMP: Your time entry was adjusted — ${date}`,
      manualTimeEntryHtml(employee[0].full_name, date, inStr, outStr, note, session.fullName)
    )
  }

  return NextResponse.json({ ok: true })
}
