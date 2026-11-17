import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser, sendPushToUsers } from '@/lib/apns'
import { sendDmEodRecap } from '@/lib/dm-eod-recap'

export const maxDuration = 60

export async function GET() {
  // Check if it's actually 9 PM (or later) in Central Time before proceeding.
  // Cron runs at both 2 AM and 3 AM UTC to cover DST transitions.
  // During CST (winter): 2 AM UTC = 8 PM CST (too early), 3 AM UTC = 9 PM CST (correct)
  // During CDT (summer): 2 AM UTC = 9 PM CDT (correct), 3 AM UTC = 10 PM CDT (no-op)
  const cstHour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }))
  if (cstHour < 21) {
    return NextResponse.json({ ok: true, skipped: true, reason: `Central time hour is ${cstHour}, waiting for 21:00` })
  }

  const cstDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  // Use NOW() as the clock-out time (it's 9 PM Central or later)
  const clockOutUtc = new Date()

  // Find all users still clocked in (shifts with no clock_out_at)
  const activeShifts = await query<{
    shift_id: string
    user_id: string
    user_name: string
    user_email: string
    user_role: string
    org_id: string | null
    manager_id: string | null
  }>(`
    SELECT
      s.id AS shift_id,
      s.user_id,
      u.full_name AS user_name,
      u.email AS user_email,
      u.role AS user_role,
      u.org_id,
      u.manager_id
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    WHERE s.clock_out_at IS NULL
      AND s.clock_in_at IS NOT NULL
  `)

  if (activeShifts.length === 0) {
    return NextResponse.json({ ok: true, clocked_out: 0 })
  }

  const shiftIds = activeShifts.map(s => s.shift_id)

  // Close any open breaks for these shifts
  await query(`
    UPDATE shift_breaks
    SET break_end = $1
    WHERE shift_id = ANY($2::uuid[])
      AND break_end IS NULL
  `, [clockOutUtc.toISOString(), shiftIds])

  // Clock everyone out
  await query(`
    UPDATE shifts
    SET
      clock_out_at = $1,
      is_manual = TRUE,
      manual_note = 'Auto clocked out at 9:00 PM CST',
      manual_by = NULL
    WHERE id = ANY($2::uuid[])
      AND clock_out_at IS NULL
  `, [clockOutUtc.toISOString(), shiftIds])

  // Insert a flag for each affected employee (skip DMs and above — they just forgot to clock out)
  for (const s of activeShifts) {
    if (s.user_role !== 'employee') continue
    // Skip if flag already exists for this shift
    const existingAutoFlag = await queryOne(`SELECT id FROM flags WHERE shift_id = $1 AND type = 'auto_clock_out' LIMIT 1`, [s.shift_id]).catch(() => null)
    if (!existingAutoFlag) {
      await query(`
        INSERT INTO flags (user_id, shift_id, type, date, detail)
        VALUES ($1, $2, 'auto_clock_out', $3, $4)
      `, [
        s.user_id,
        s.shift_id,
        cstDate,
        `${s.user_name} was automatically clocked out at 9:00 PM CST. Please review and adjust if needed.`,
      ]).catch(() => {})
    }
  }

  // Notify affected employees
  await sendPushToUsers(
    activeShifts.map(s => s.user_id),
    'Auto Clock-Out',
    'You were automatically clocked out at 9:00 PM. Please contact your manager if your hours need adjustment.',
    'auto_clock_out'
  ).catch(() => {})

  // Notify each manager whose employees were affected
  const managerIds = [...new Set(activeShifts.map(s => s.manager_id).filter(Boolean) as string[])]
  for (const managerId of managerIds) {
    const affected = activeShifts.filter(s => s.manager_id === managerId)
    const names = affected.map(s => s.user_name.split(' ')[0]).join(', ')
    await sendPushToUser(
      managerId,
      'Auto Clock-Out',
      `${affected.length === 1 ? names : `${affected.length} employees (${names})`} ${affected.length === 1 ? 'was' : 'were'} auto clocked out at 9:00 PM. Review timecards to adjust.`,
      'auto_clock_out'
    ).catch(() => {})
  }

  // Generate EOD recaps for DMs who were auto-clocked out
  const dmShifts = activeShifts.filter(s => s.user_role === 'manager' && s.org_id)
  let recapsSent = 0
  for (const dm of dmShifts) {
    await sendDmEodRecap({
      dmId: dm.user_id,
      dmName: dm.user_name,
      dmEmail: dm.user_email,
      orgId: dm.org_id!,
      shiftId: dm.shift_id,
    })
    recapsSent++
  }

  return NextResponse.json({ ok: true, clocked_out: activeShifts.length, recaps_sent: recapsSent })
}
