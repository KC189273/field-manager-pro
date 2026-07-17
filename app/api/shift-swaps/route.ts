import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser, isEmailEnabled } from '@/lib/apns'
import { getReceiptViewUrl } from '@/lib/s3'
import { sendEmail, shiftSwapRequestedHtml } from '@/lib/notifications'

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS shift_swap_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID,
      requester_id UUID NOT NULL,
      target_id UUID NOT NULL,
      manager_id UUID NOT NULL,
      requester_shift_id UUID NOT NULL,
      target_shift_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_target',
      requester_note TEXT,
      target_note TEXT,
      dm_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      responded_at TIMESTAMPTZ,
      decided_at TIMESTAMPTZ
    )
  `)
}

// GET /api/shift-swaps?peerShifts=true&weekStart=YYYY-MM-DD — peer published shifts for swap picker
// GET /api/shift-swaps — list swap requests for current user
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTable() } catch {}

  const { searchParams } = new URL(req.url)

  // Return employee's own upcoming published shifts for swap creation
  if (searchParams.get('myShifts') === 'true') {
    if (session.role !== 'employee') return NextResponse.json({ myShifts: [] })

    const today = new Date().toISOString().split('T')[0]
    const myShifts = await query<{ id: string; shift_date: string; start_time: string; end_time: string; store_address: string | null }>(`
      SELECT ss.id, ss.shift_date::text, ss.start_time::text, ss.end_time::text, sl.address AS store_address
      FROM scheduled_shifts ss
      LEFT JOIN dm_store_locations sl ON sl.id = ss.store_location_id
      WHERE ss.employee_id = $1
        AND ss.shift_date >= $2
        AND EXISTS (
          SELECT 1 FROM scheduled_shifts_publish ssp
          WHERE ssp.store_location_id = ss.store_location_id
            AND ssp.week_start = ss.shift_date - ((EXTRACT(DOW FROM ss.shift_date)::int + 6) % 7)
        )
      ORDER BY ss.shift_date, ss.start_time
      LIMIT 14
    `, [session.id, today])

    return NextResponse.json({ myShifts })
  }

  // Return available target shifts (coworkers under same manager) for a given shift
  if (searchParams.get('availableFor')) {
    if (session.role !== 'employee') return NextResponse.json({ targets: [] })

    const shiftId = searchParams.get('availableFor')!
    const myShift = await queryOne<{ shift_date: string; store_location_id: string }>(`
      SELECT shift_date::text, store_location_id FROM scheduled_shifts WHERE id = $1 AND employee_id = $2
    `, [shiftId, session.id])
    if (!myShift) return NextResponse.json({ targets: [] })

    const myInfo = await queryOne<{ manager_id: string | null }>(`SELECT manager_id FROM users WHERE id = $1`, [session.id])
    if (!myInfo?.manager_id) return NextResponse.json({ targets: [] })

    // Get the week range for this shift
    const shiftDate = new Date(myShift.shift_date + 'T12:00:00')
    const dow = shiftDate.getDay()
    const monday = new Date(shiftDate)
    monday.setDate(shiftDate.getDate() - (dow === 0 ? 6 : dow - 1))
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    const weekStart = monday.toISOString().split('T')[0]
    const weekEnd = sunday.toISOString().split('T')[0]

    const targets = await query<{ id: string; shift_date: string; start_time: string; end_time: string; employee_name: string; store_address: string | null }>(`
      SELECT ss.id, ss.shift_date::text, ss.start_time::text, ss.end_time::text,
             u.full_name AS employee_name, sl.address AS store_address
      FROM scheduled_shifts ss
      JOIN users u ON u.id = ss.employee_id
      LEFT JOIN dm_store_locations sl ON sl.id = ss.store_location_id
      WHERE u.manager_id = $1
        AND ss.employee_id != $2
        AND ss.shift_date >= $3
        AND ss.shift_date <= $4
        AND u.is_active = TRUE
        AND EXISTS (
          SELECT 1 FROM scheduled_shifts_publish ssp
          WHERE ssp.store_location_id = ss.store_location_id
            AND ssp.week_start = ss.shift_date - ((EXTRACT(DOW FROM ss.shift_date)::int + 6) % 7)
        )
      ORDER BY u.full_name, ss.shift_date, ss.start_time
    `, [myInfo.manager_id, session.id, weekStart, weekEnd])

    return NextResponse.json({ targets })
  }

  if (searchParams.get('peerShifts') === 'true') {
    if (session.role !== 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const weekStart = searchParams.get('weekStart')
    if (!weekStart) return NextResponse.json({ error: 'weekStart required' }, { status: 400 })

    const myInfo = await queryOne<{ manager_id: string | null }>(
      `SELECT manager_id FROM users WHERE id = $1`, [session.id]
    )
    if (!myInfo?.manager_id) return NextResponse.json({ shifts: [] })

    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    const weekEndStr = weekEnd.toISOString().split('T')[0]

    const shifts = await query(`
      SELECT
        ss.id, ss.shift_date::text AS shift_date,
        ss.start_time::text AS start_time, ss.end_time::text AS end_time,
        ss.employee_id, u.full_name AS employee_name,
        sl.address AS store_address, ss.role_note
      FROM scheduled_shifts ss
      JOIN users u ON u.id = ss.employee_id
      JOIN dm_store_locations sl ON sl.id = ss.store_location_id
      INNER JOIN scheduled_shifts_publish ssp
        ON ssp.store_location_id = ss.store_location_id
        AND ssp.week_start = $1
      WHERE u.manager_id = $2
        AND ss.employee_id != $3
        AND ss.shift_date >= $1
        AND ss.shift_date <= $4
      ORDER BY u.full_name, ss.shift_date, ss.start_time
    `, [weekStart, myInfo.manager_id, session.id, weekEndStr])

    return NextResponse.json({ shifts })
  }

  const swaps = await query(`
    SELECT
      ssr.id, ssr.status, ssr.requester_note, ssr.target_note, ssr.dm_note,
      ssr.created_at::text, ssr.responded_at::text, ssr.decided_at::text,
      ssr.requester_id, ru.full_name AS requester_name, ru.avatar_key AS requester_avatar_key,
      ssr.target_id, tu.full_name AS target_name, tu.avatar_key AS target_avatar_key,
      ssr.manager_id,
      rs.id AS requester_shift_id, rs.shift_date::text AS requester_shift_date,
      rs.start_time::text AS requester_shift_start, rs.end_time::text AS requester_shift_end,
      rsl.address AS requester_shift_store,
      ts.id AS target_shift_id, ts.shift_date::text AS target_shift_date,
      ts.start_time::text AS target_shift_start, ts.end_time::text AS target_shift_end,
      tsl.address AS target_shift_store
    FROM shift_swap_requests ssr
    JOIN users ru ON ru.id = ssr.requester_id
    JOIN users tu ON tu.id = ssr.target_id
    LEFT JOIN scheduled_shifts rs ON rs.id = ssr.requester_shift_id
    LEFT JOIN dm_store_locations rsl ON rsl.id = rs.store_location_id
    LEFT JOIN scheduled_shifts ts ON ts.id = ssr.target_shift_id
    LEFT JOIN dm_store_locations tsl ON tsl.id = ts.store_location_id
    WHERE ssr.requester_id = $1 OR ssr.target_id = $1 OR ssr.manager_id = $1
    ORDER BY ssr.created_at DESC
    LIMIT 100
  `, [session.id])
  const swapsWithAvatars = await Promise.all(
    (swaps as Record<string, unknown>[]).map(async s => ({
      ...s,
      requester_avatar_url: s.requester_avatar_key ? await getReceiptViewUrl(s.requester_avatar_key as string) : null,
      target_avatar_url: s.target_avatar_key ? await getReceiptViewUrl(s.target_avatar_key as string) : null,
    }))
  )

  return NextResponse.json({ swaps: swapsWithAvatars })
}

// POST /api/shift-swaps — create swap request (employees only)
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTable() } catch {}

  const { requesterShiftId, targetShiftId, note } = await req.json()
  if (!requesterShiftId || !targetShiftId) {
    return NextResponse.json({ error: 'requesterShiftId and targetShiftId are required' }, { status: 400 })
  }

  const requesterShift = await queryOne<{ employee_id: string; shift_date: string; start_time: string; end_time: string }>(
    `SELECT employee_id, shift_date::text, start_time::text, end_time::text FROM scheduled_shifts WHERE id = $1`,
    [requesterShiftId]
  )
  if (!requesterShift || requesterShift.employee_id !== session.id) {
    return NextResponse.json({ error: 'Invalid shift' }, { status: 400 })
  }

  const targetShift = await queryOne<{ employee_id: string }>(
    `SELECT employee_id FROM scheduled_shifts WHERE id = $1`, [targetShiftId]
  )
  if (!targetShift) return NextResponse.json({ error: 'Target shift not found' }, { status: 400 })

  const targetId = targetShift.employee_id
  if (targetId === session.id) {
    return NextResponse.json({ error: 'Cannot swap with yourself' }, { status: 400 })
  }

  const myInfo = await queryOne<{ manager_id: string | null; org_id: string | null }>(
    `SELECT manager_id, org_id FROM users WHERE id = $1`, [session.id]
  )
  if (!myInfo?.manager_id) {
    return NextResponse.json({ error: 'No manager assigned to your account' }, { status: 400 })
  }

  const targetInfo = await queryOne<{ manager_id: string | null; full_name: string; email: string }>(
    `SELECT manager_id, full_name, email FROM users WHERE id = $1`, [targetId]
  )
  if (!targetInfo || targetInfo.manager_id !== myInfo.manager_id) {
    return NextResponse.json({ error: 'Can only swap with employees under the same manager' }, { status: 400 })
  }

  // Prevent duplicate pending requests on the same shifts
  const existing = await queryOne(
    `SELECT 1 FROM shift_swap_requests
     WHERE status IN ('pending_target', 'pending_dm')
       AND (requester_shift_id = $1 OR target_shift_id = $1 OR requester_shift_id = $2 OR target_shift_id = $2)`,
    [requesterShiftId, targetShiftId]
  )
  if (existing) {
    return NextResponse.json({ error: 'One of these shifts already has a pending swap request' }, { status: 400 })
  }

  const result = await queryOne<{ id: string }>(
    `INSERT INTO shift_swap_requests (org_id, requester_id, target_id, manager_id, requester_shift_id, target_shift_id, requester_note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [myInfo.org_id, session.id, targetId, myInfo.manager_id, requesterShiftId, targetShiftId, note?.trim() || null]
  )

  const shiftLabel = new Date(requesterShift.shift_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })

  sendPushToUser(targetId, 'Shift Swap Request', `${session.fullName} wants to swap shifts with you`, 'shift_swap').catch(() => {})

  if (await isEmailEnabled(targetId)) {
    sendEmail(
      targetInfo.email,
      `Shift Swap Request from ${session.fullName}`,
      shiftSwapRequestedHtml(targetInfo.full_name, session.fullName, shiftLabel)
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true, id: result?.id })
}
