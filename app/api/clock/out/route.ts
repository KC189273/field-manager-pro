import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendEmail, flagAlertHtml } from '@/lib/notifications'
import { sendPushToUsers, isEmailEnabled } from '@/lib/apns'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lat, lng, address, handoffNote } = await req.json()

  // Ensure handoff_note column exists
  await query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS handoff_note TEXT`).catch(() => {})

  const shift = await queryOne<{ id: string; clock_in_at: string }>(
    `SELECT id, clock_in_at FROM shifts
     WHERE user_id = $1 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL`,
    [session.id]
  )
  if (!shift) return NextResponse.json({ error: 'No active shift' }, { status: 404 })

  // End any active break before clocking out
  await query(
    `UPDATE shift_breaks SET break_end = NOW() WHERE shift_id = $1 AND break_end IS NULL`,
    [shift.id]
  ).catch(() => {})

  await query(
    `UPDATE shifts SET clock_out_at = NOW(), clock_out_lat = $1, clock_out_lng = $2, clock_out_address = $3, handoff_note = $4
     WHERE id = $5`,
    [lat, lng, address ?? null, handoffNote?.trim() || null, shift.id]
  )

  // Push handoff note to manager if one was left
  if (handoffNote?.trim()) {
    const user = await queryOne<{ manager_id: string | null }>(
      `SELECT manager_id FROM users WHERE id = $1`, [session.id]
    ).catch(() => null)
    if (user?.manager_id) {
      const { sendPushToUser } = await import('@/lib/apns')
      sendPushToUser(
        user.manager_id,
        `Handoff Note from ${session.fullName}`,
        handoffNote.trim(),
        'handoff_note'
      ).catch(() => {})
    }
  }

  // Record final breadcrumb (only if GPS was available)
  if (lat && lng) {
    await query(
      `INSERT INTO gps_breadcrumbs (shift_id, user_id, lat, lng, recorded_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [shift.id, session.id, lat, lng]
    )
  }

  // Notify ops managers+ when a DM clocks out
  if (session.role === 'manager' && session.org_id) {
    const durationMs = Date.now() - new Date(shift.clock_in_at).getTime()
    const h = Math.floor(durationMs / 3600000)
    const m = Math.floor((durationMs % 3600000) / 60000)
    const durationStr = h > 0 ? `${h}h ${m}m` : `${m}m`
    const notifyUsers = await query<{ id: string }>(
      `SELECT id FROM users WHERE role IN ('ops_manager','owner','sales_director','developer') AND is_active = TRUE AND org_id = $1`,
      [session.org_id]
    )
    if (notifyUsers.length > 0) {
      sendPushToUsers(
        notifyUsers.map(u => u.id),
        'DM Clocked Out',
        `${session.fullName} clocked out after ${durationStr}`,
        'clock_out'
      ).catch(() => {})
    }
  }

  // Skip overtime check for salary employees
  const userRecord = await queryOne<{ pay_type: string }>(
    `SELECT pay_type FROM users WHERE id = $1`, [session.id]
  ).catch(() => null)
  if (userRecord?.pay_type === 'salary') {
    return NextResponse.json({ ok: true })
  }

  // Check for overtime (>40h this week, deducting unpaid break time)
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1)
  weekStart.setHours(0, 0, 0, 0)

  const hoursResult = await queryOne<{ total_seconds: number }>(
    `SELECT EXTRACT(EPOCH FROM SUM(clock_out_at - clock_in_at)) as total_seconds
     FROM shifts
     WHERE user_id = $1 AND clock_in_at >= $2 AND clock_out_at IS NOT NULL`,
    [session.id, weekStart.toISOString()]
  )
  const breakResult = await queryOne<{ break_seconds: number }>(
    `SELECT EXTRACT(EPOCH FROM SUM(b.break_end - b.break_start)) AS break_seconds
     FROM shift_breaks b
     JOIN shifts s ON s.id = b.shift_id
     WHERE b.user_id = $1 AND s.clock_in_at >= $2 AND b.break_end IS NOT NULL`,
    [session.id, weekStart.toISOString()]
  ).catch(() => null)

  const grossHours = (hoursResult?.total_seconds ?? 0) / 3600
  const breakHours = (breakResult?.break_seconds ?? 0) / 3600
  const totalHours = Math.max(0, grossHours - breakHours)

  if (totalHours > 40) {
    const existing = await queryOne(
      `SELECT id FROM flags WHERE user_id = $1 AND type = 'overtime' AND date >= $2`,
      [session.id, weekStart.toISOString().split('T')[0]]
    )
    if (!existing) {
      await query(
        `INSERT INTO flags (user_id, shift_id, type, date, detail) VALUES ($1, $2, 'overtime', CURRENT_DATE, $3)`,
        [session.id, shift.id, `${totalHours.toFixed(1)} hours this week`]
      )
      // Only notify the employee's direct DM (by manager_id), plus ops managers in the org
      const managers = await query<{ id: string; email: string }>(
        `SELECT id, email FROM users
         WHERE is_active = TRUE
           AND (
             id = (SELECT manager_id FROM users WHERE id = $1)
             OR (role IN ('ops_manager', 'owner', 'sales_director') AND org_id = (SELECT org_id FROM users WHERE id = $1))
           )`,
        [session.id]
      )
      for (const m of managers) {
        if (await isEmailEnabled(m.id)) {
          await sendEmail(m.email, `FMP: Overtime — ${session.fullName}`,
            flagAlertHtml(session.fullName, 'Overtime', new Date().toLocaleDateString(),
              `${totalHours.toFixed(1)} hours logged this week (40h limit)`)
          )
        }
      }
      sendPushToUsers(
        managers.map(m => m.id),
        'Overtime Flag',
        `${session.fullName} has logged ${totalHours.toFixed(1)} hours this week`,
        'flag_created'
      ).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true })
}
