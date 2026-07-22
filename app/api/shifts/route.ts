import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager, isOwner, type Role } from '@/lib/auth'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'

const canManageShifts = (role: Role) => isManager(role) || isOwner(role) || role === 'developer'
import { query, queryOne } from '@/lib/db'
import { sendEmail, manualTimeEntryHtml } from '@/lib/notifications'
import { getReceiptViewUrl } from '@/lib/s3'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const team = searchParams.get('team') === 'true'

  // DM edit stats — SD/owner/developer only
  const stats = searchParams.get('stats')
  if (stats === 'dm-edits') {
    if (!['sales_director', 'ops_manager', 'owner', 'developer'].includes(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const orgFilter = await getOrgFilter(session)
    const params: unknown[] = []
    let orgWhere = ''
    if (orgFilter.orgId) {
      params.push(orgFilter.orgId)
      orgWhere = ` AND dm.org_id = $${params.length}`
    }

    // Date range filter
    let dateWhere = ''
    if (from) { params.push(from); dateWhere += ` AND se.edited_at >= $${params.length}::date` }
    if (to) { params.push(to + 'T23:59:59'); dateWhere += ` AND se.edited_at <= $${params.length}::timestamptz` }

    let manualDateWhere = ''
    const manualParams = [...params]
    if (from) { manualParams.push(from); manualDateWhere += ` AND s.created_at >= $${manualParams.length}::date` }
    if (to) { manualParams.push(to + 'T23:59:59'); manualDateWhere += ` AND s.created_at <= $${manualParams.length}::timestamptz` }

    // Edits from shift_edits table
    const editStats = await query<{
      dm_id: string; dm_name: string; edit_count: number;
      clock_in_changes: number; clock_out_changes: number;
      hours_added: number; hours_removed: number
    }>(`
      SELECT
        se.edited_by AS dm_id,
        dm.full_name AS dm_name,
        COUNT(*)::int AS edit_count,
        COUNT(*) FILTER (WHERE se.old_clock_in != se.new_clock_in)::int AS clock_in_changes,
        COUNT(*) FILTER (WHERE se.old_clock_out IS DISTINCT FROM se.new_clock_out)::int AS clock_out_changes,
        ROUND(COALESCE(SUM(
          CASE WHEN se.new_clock_out IS NOT NULL AND se.old_clock_out IS NOT NULL THEN
            GREATEST(
              (EXTRACT(EPOCH FROM (se.new_clock_out - se.new_clock_in)) - EXTRACT(EPOCH FROM (se.old_clock_out - se.old_clock_in))) / 3600.0,
              0
            )
          ELSE 0 END
        ), 0)::numeric, 2)::float AS hours_added,
        ROUND(COALESCE(SUM(
          CASE WHEN se.new_clock_out IS NOT NULL AND se.old_clock_out IS NOT NULL THEN
            GREATEST(
              (EXTRACT(EPOCH FROM (se.old_clock_out - se.old_clock_in)) - EXTRACT(EPOCH FROM (se.new_clock_out - se.new_clock_in))) / 3600.0,
              0
            )
          ELSE 0 END
        ), 0)::numeric, 2)::float AS hours_removed
      FROM shift_edits se
      JOIN users dm ON dm.id = se.edited_by
      WHERE dm.role = 'manager'${orgWhere}${dateWhere}
      GROUP BY se.edited_by, dm.full_name
      ORDER BY dm.full_name
    `, params)

    // Manual entries (added shifts) from shifts table
    const manualStats = await query<{ dm_id: string; dm_name: string; manual_entries: number }>(`
      SELECT
        s.manual_by AS dm_id,
        dm.full_name AS dm_name,
        COUNT(*)::int AS manual_entries
      FROM shifts s
      JOIN users dm ON dm.id = s.manual_by
      WHERE s.is_manual = TRUE AND dm.role = 'manager'${orgWhere}${manualDateWhere}
      GROUP BY s.manual_by, dm.full_name
      ORDER BY dm.full_name
    `, manualParams)

    // Merge the two datasets
    const merged = new Map<string, {
      dm_id: string; dm_name: string; edit_count: number;
      clock_in_changes: number; clock_out_changes: number;
      manual_entries: number; hours_added: number; hours_removed: number
    }>()

    for (const e of editStats) {
      merged.set(e.dm_id, { ...e, manual_entries: 0 })
    }
    for (const m of manualStats) {
      const existing = merged.get(m.dm_id)
      if (existing) {
        existing.manual_entries = m.manual_entries
      } else {
        merged.set(m.dm_id, {
          dm_id: m.dm_id, dm_name: m.dm_name,
          edit_count: 0, clock_in_changes: 0, clock_out_changes: 0,
          manual_entries: m.manual_entries, hours_added: 0, hours_removed: 0,
        })
      }
    }

    return NextResponse.json({
      dmEdits: Array.from(merged.values()).sort((a, b) => a.dm_name.localeCompare(b.dm_name)),
    })
  }

  // Team view: all employees reporting to this manager/owner/developer
  if (team) {
    if (!canManageShifts(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const params: unknown[] = []
    let sql = `
      SELECT s.*, u.full_name, u.username, u.avatar_key,
        mb.full_name as manual_by_name,
        sl.address as store_name,
        COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start))) FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0) as break_seconds,
        (EXTRACT(EPOCH FROM (COALESCE(s.clock_out_at, NOW()) - s.clock_in_at)) - COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start))) FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)) as duration_seconds,
        (SELECT json_agg(json_build_object('id', b.id, 'break_start', b.break_start, 'break_end', b.break_end) ORDER BY b.break_start) FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL) as breaks,
        (SELECT json_agg(json_build_object('old_clock_in', se.old_clock_in, 'new_clock_in', se.new_clock_in, 'old_clock_out', se.old_clock_out, 'new_clock_out', se.new_clock_out, 'note', se.note, 'edited_by', eb.full_name, 'edited_at', se.edited_at) ORDER BY se.edited_at DESC) FROM shift_edits se JOIN users eb ON eb.id = se.edited_by WHERE se.shift_id = s.id) as edits
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN users mb ON mb.id = s.manual_by
      LEFT JOIN dm_store_locations sl ON sl.id = s.store_location_id
      WHERE u.role != 'developer'
    `

    if (session.role === 'manager') {
      params.push(session.id)
      sql += ` AND u.manager_id = $${params.length}`
    } else {
      const orgFilter = await getOrgFilter(session)
      sql += appendOrgFilter(orgFilter, params, 'u')
    }

    if (from) { params.push(from); sql += ` AND s.clock_in_at >= $${params.length}` }
    if (to) { params.push(to); sql += ` AND s.clock_in_at <= $${params.length}` }
    sql += ` ORDER BY u.full_name, s.clock_in_at`

    const rawShifts = await query(sql, params)
    const shifts = await Promise.all(
      (rawShifts as Record<string, unknown>[]).map(async s => ({
        ...s,
        avatar_url: s.avatar_key ? await getReceiptViewUrl(s.avatar_key as string) : null,
      }))
    )
    return NextResponse.json({ shifts })
  }

  const userId = searchParams.get('userId') ?? session.id

  if (userId !== session.id && !canManageShifts(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let sql = `
    SELECT s.*, u.full_name, u.username, u.avatar_key,
      mb.full_name as manual_by_name,
      sl.address as store_name,
      COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start))) FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0) as break_seconds,
      (EXTRACT(EPOCH FROM (COALESCE(s.clock_out_at, NOW()) - s.clock_in_at)) - COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start))) FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)) as duration_seconds,
      (SELECT json_agg(json_build_object('id', b.id, 'break_start', b.break_start, 'break_end', b.break_end) ORDER BY b.break_start) FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL) as breaks,
      (SELECT json_agg(json_build_object('old_clock_in', se.old_clock_in, 'new_clock_in', se.new_clock_in, 'old_clock_out', se.old_clock_out, 'new_clock_out', se.new_clock_out, 'note', se.note, 'edited_by', eb.full_name, 'edited_at', se.edited_at) ORDER BY se.edited_at DESC) FROM shift_edits se JOIN users eb ON eb.id = se.edited_by WHERE se.shift_id = s.id) as edits
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN users mb ON mb.id = s.manual_by
    LEFT JOIN dm_store_locations sl ON sl.id = s.store_location_id
    WHERE s.user_id = $1
  `
  const params: unknown[] = [userId]

  if (from) { params.push(from); sql += ` AND s.clock_in_at >= $${params.length}` }
  if (to) { params.push(to); sql += ` AND s.clock_in_at <= $${params.length}` }
  sql += ` ORDER BY s.clock_in_at DESC LIMIT 50`

  const rawShifts = await query(sql, params)
  const shifts = await Promise.all(
    (rawShifts as Record<string, unknown>[]).map(async s => ({
      ...s,
      avatar_url: s.avatar_key ? await getReceiptViewUrl(s.avatar_key as string) : null,
    }))
  )
  return NextResponse.json({ shifts })
}

async function isTimecardLocked(userId: string, shiftDate: string): Promise<boolean> {
  const row = await queryOne<{ locked: boolean }>(`
    SELECT EXISTS(
      SELECT 1
      FROM payroll_dm_approvals pda
      JOIN payroll_periods pp ON pp.id = pda.period_id
      JOIN users u ON u.id = $1
      WHERE pda.dm_id = u.manager_id
        AND $2::date >= pp.period_start
        AND $2::date <= pp.period_end
    ) AS locked
  `, [userId, shiftDate])
  return row?.locked ?? false
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManageShifts(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId, clockIn, clockOut, note } = await req.json()
  if (!userId || !clockIn || !note) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

  // DMs cannot add manual entries for themselves
  if (session.role === 'manager' && userId === session.id) {
    return NextResponse.json({ error: 'DMs cannot adjust their own timecards. Please contact your Sales Director to make changes.' }, { status: 403 })
  }

  // Timecard locking check (owners and developers can always add entries)
  if (!['owner', 'sales_director', 'developer'].includes(session.role)) {
    const clockInDate = new Date(clockIn).toISOString().split('T')[0]
    if (await isTimecardLocked(userId, clockInDate)) {
      return NextResponse.json({ error: 'Timecards for this period are locked — use Payroll Adjustment expense instead' }, { status: 403 })
    }
  }

  const employee = await query<{ id: string; full_name: string; email: string; org_id: string | null }>(
    `SELECT id, full_name, email, org_id FROM users WHERE id = $1`, [userId]
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

  // Email the employee whose time was adjusted
  await sendEmail(
    employee[0].email,
    `FMP: Your time entry was adjusted — ${date}`,
    manualTimeEntryHtml(employee[0].full_name, date, clockInStr, clockOutStr, note, session.fullName)
  )

  // Email the person who made the adjustment (if different from the employee)
  if (userId !== session.id) {
    const adjuster = await queryOne<{ email: string }>(
      'SELECT email FROM users WHERE id = $1', [session.id]
    )
    if (adjuster) {
      sendEmail(
        adjuster.email,
        `FMP: Time entry confirmed — ${employee[0].full_name} (${date})`,
        manualTimeEntryHtml(employee[0].full_name, date, clockInStr, clockOutStr, note, session.fullName)
      ).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { shiftId, clockIn, clockOut, note, shiftNote } = await req.json()
  if (!shiftId) return NextResponse.json({ error: 'shiftId required' }, { status: 400 })

  // Note-only mode: any user can annotate their own shifts; managers can annotate team shifts
  if (shiftNote !== undefined) {
    const shift = await queryOne<{ user_id: string }>('SELECT user_id FROM shifts WHERE id = $1', [shiftId])
    if (!shift) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
    if (shift.user_id !== session.id && !canManageShifts(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    await query('UPDATE shifts SET shift_note = $1 WHERE id = $2', [shiftNote || null, shiftId])
    return NextResponse.json({ ok: true })
  }

  // Time correction flow — manager+ only, note required
  if (!canManageShifts(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!note) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

  // DMs cannot edit their own shifts — must contact SD
  if (session.role === 'manager') {
    const ownShift = await queryOne<{ user_id: string }>('SELECT user_id FROM shifts WHERE id = $1', [shiftId])
    if (ownShift?.user_id === session.id) {
      return NextResponse.json({ error: 'DMs cannot adjust their own timecards. Please contact your Sales Director to make changes.' }, { status: 403 })
    }
  }

  // Timecard locking check (owners, SD, and developers can always correct)
  if (!['owner', 'sales_director', 'developer'].includes(session.role)) {
    const shiftRecord = await queryOne<{ user_id: string; clock_in_at: string }>('SELECT user_id, clock_in_at FROM shifts WHERE id = $1', [shiftId])
    if (shiftRecord) {
      const shiftDate = new Date(shiftRecord.clock_in_at).toISOString().split('T')[0]
      if (await isTimecardLocked(shiftRecord.user_id, shiftDate)) {
        return NextResponse.json({ error: 'Timecards for this period are locked' }, { status: 403 })
      }
    }
  }

  // Capture original values before updating
  const before = await queryOne<{ clock_in_at: string; clock_out_at: string | null }>(
    'SELECT clock_in_at, clock_out_at FROM shifts WHERE id = $1', [shiftId]
  )

  const shift = await query<{ user_id: string }>(
    `UPDATE shifts SET clock_in_at = COALESCE($1, clock_in_at), clock_out_at = $2,
     is_manual = TRUE, manual_note = $3, manual_by = $4
     WHERE id = $5 RETURNING user_id`,
    [clockIn ?? null, clockOut ?? null, note, session.id, shiftId]
  )
  if (!shift[0]) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })

  // Log the edit to shift_edits audit table
  if (before) {
    await queryOne(`
      INSERT INTO shift_edits (shift_id, edited_by, old_clock_in, new_clock_in, old_clock_out, new_clock_out, note)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      shiftId, session.id,
      before.clock_in_at, clockIn ?? before.clock_in_at,
      before.clock_out_at, clockOut ?? before.clock_out_at,
      note,
    ])
  }

  const employee = await query<{ full_name: string; email: string; org_id: string | null }>(
    `SELECT full_name, email, org_id FROM users WHERE id = $1`, [shift[0].user_id]
  )
  if (employee[0]) {
    const date = clockIn ? new Date(clockIn).toLocaleDateString('en-US', { timeZone: 'America/Chicago' }) : 'Unknown'
    const inStr = clockIn ? new Date(clockIn).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : 'Unchanged'
    const outStr = clockOut ? new Date(clockOut).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : 'Not set'
    // Email the employee whose time was adjusted
    await sendEmail(
      employee[0].email,
      `FMP: Your time entry was adjusted — ${date}`,
      manualTimeEntryHtml(employee[0].full_name, date, inStr, outStr, note, session.fullName)
    )

    // Email the person who made the adjustment (if different from the employee)
    if (shift[0].user_id !== session.id) {
      const adjuster = await queryOne<{ email: string }>(
        'SELECT email FROM users WHERE id = $1', [session.id]
      )
      if (adjuster) {
        sendEmail(
          adjuster.email,
          `FMP: Time correction confirmed — ${employee[0].full_name} (${date})`,
          manualTimeEntryHtml(employee[0].full_name, date, inStr, outStr, note, session.fullName)
        ).catch(() => {})
      }
    }
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManageShifts(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { shiftId } = await req.json()
  if (!shiftId) return NextResponse.json({ error: 'shiftId required' }, { status: 400 })

  const shiftRecord = await queryOne<{ user_id: string; clock_in_at: string }>(
    'SELECT user_id, clock_in_at FROM shifts WHERE id = $1', [shiftId]
  )
  if (!shiftRecord) return NextResponse.json({ error: 'Shift not found' }, { status: 404 })

  // DMs cannot delete their own shifts; can only delete shifts for their direct reports
  if (session.role === 'manager') {
    if (shiftRecord.user_id === session.id) {
      return NextResponse.json({ error: 'DMs cannot adjust their own timecards. Please contact your Sales Director to make changes.' }, { status: 403 })
    }
    const employee = await queryOne<{ manager_id: string | null }>(
      'SELECT manager_id FROM users WHERE id = $1', [shiftRecord.user_id]
    )
    if (employee?.manager_id !== session.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Timecard locking check (owners and developers bypass)
  if (!['owner', 'sales_director', 'developer'].includes(session.role)) {
    const shiftDate = new Date(shiftRecord.clock_in_at).toISOString().split('T')[0]
    if (await isTimecardLocked(shiftRecord.user_id, shiftDate)) {
      return NextResponse.json({ error: 'Timecards for this period are locked' }, { status: 403 })
    }
  }

  await query('DELETE FROM shift_breaks WHERE shift_id = $1', [shiftId])
  await query('DELETE FROM shifts WHERE id = $1', [shiftId])

  return NextResponse.json({ ok: true })
}
