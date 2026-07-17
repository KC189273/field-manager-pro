import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendPushToUser, sendPushToUsers } from '@/lib/apns'
import { sendDmEodRecap } from '@/lib/dm-eod-recap'

export const maxDuration = 60

export async function GET() {
  // Compute 9:00 PM CST as an explicit timestamp
  // This cron runs at 03:00 UTC = 21:00 CST. We construct the target time
  // based on NOW() so any slight scheduling drift is handled gracefully.
  const nowUtc = new Date()
  // Represent 9 PM CST (UTC-6) for the current CST calendar day
  const cstOffsetMs = -6 * 60 * 60 * 1000
  const cstNow = new Date(nowUtc.getTime() + cstOffsetMs)
  const cstDate = cstNow.toISOString().split('T')[0] // YYYY-MM-DD in CST
  // 9 PM CST expressed as UTC
  const clockOutUtc = new Date(`${cstDate}T21:00:00-06:00`)

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

  // Insert a flag for each affected user
  for (const s of activeShifts) {
    await query(`
      INSERT INTO flags (user_id, shift_id, type, date, detail)
      VALUES ($1, $2, 'auto_clock_out', $3, $4)
      ON CONFLICT DO NOTHING
    `, [
      s.user_id,
      s.shift_id,
      cstDate,
      `${s.user_name} was automatically clocked out at 9:00 PM CST. Please review and adjust if needed.`,
    ]).catch(() => {})
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
