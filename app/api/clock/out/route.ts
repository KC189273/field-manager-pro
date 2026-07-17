import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendEmail, flagAlertHtml } from '@/lib/notifications'
import { sendPushToUsers, isEmailEnabled } from '@/lib/apns'
import { sendDmEodRecap } from '@/lib/dm-eod-recap'

export const maxDuration = 30

let ensured = false
async function ensureShiftColumns() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS handoff_note TEXT`)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lat, lng, address, handoffNote } = await req.json()

  try { await ensureShiftColumns() } catch {}

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
  ).catch(e => console.error('Clock-out async error:', e))

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
      ).catch(e => console.error('Clock-out async error:', e))
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

  // Check OT projection for this employee on clock-out — alert DM if trending 45+
  if (session.role === 'employee') {
    (async () => {
      try {
        const now = new Date()
        const day = now.getDay()
        const monday = new Date(now)
        monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
        monday.setHours(0, 0, 0, 0)
        const sunday = new Date(monday)
        sunday.setDate(monday.getDate() + 6)
        const weekStart = monday.toISOString().split('T')[0]
        const weekEnd = sunday.toISOString().split('T')[0]
        const today = now.toISOString().split('T')[0]

        const empInfo = await queryOne<{ manager_id: string | null; is_floater: boolean }>(
          `SELECT manager_id, COALESCE(is_floater, false) as is_floater FROM users WHERE id = $1`, [session.id]
        )
        if (!empInfo?.manager_id) return

        // Net hours worked this week
        const worked = await queryOne<{ net_hours: number }>(`
          SELECT COALESCE(SUM(
            EXTRACT(EPOCH FROM (COALESCE(s.clock_out_at, NOW()) - s.clock_in_at))
            - COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start)))
                        FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)
          ) / 3600, 0)::float as net_hours
          FROM shifts s WHERE s.user_id = $1 AND s.clock_in_at >= $2 AND s.clock_in_at <= $3
        `, [session.id, weekStart, weekEnd + 'T23:59:59'])

        // Remaining scheduled hours
        const scheduled = await queryOne<{ remaining_hours: number }>(`
          SELECT COALESCE(SUM(
            EXTRACT(EPOCH FROM ((shift_date + end_time) - (shift_date + start_time))) / 3600
            - COALESCE(break_minutes, 0) / 60.0
          ), 0)::float as remaining_hours
          FROM scheduled_shifts
          WHERE employee_id = $1 AND shift_date > $2 AND shift_date <= $3
            AND EXISTS (
              SELECT 1 FROM scheduled_shifts_publish ssp
              WHERE ssp.store_location_id = scheduled_shifts.store_location_id
                AND ssp.week_start = scheduled_shifts.shift_date - ((EXTRACT(DOW FROM scheduled_shifts.shift_date)::int + 6) % 7)
            )
        `, [session.id, today, weekEnd])

        const workedHours = worked?.net_hours ?? 0
        const projectedHours = workedHours + (scheduled?.remaining_hours ?? 0)

        if (projectedHours >= 45) {
          const { sendPushToUser: push } = await import('@/lib/apns')
          const floaterTag = empInfo.is_floater ? ' [FLOATER]' : ''
          const level = projectedHours >= 50 ? 'OWNER APPROVAL NEEDED' : 'SD APPROVAL NEEDED'
          const title = `${level}: ${session.fullName}${floaterTag}`
          const body = `Projected ${projectedHours.toFixed(1)}h this week (${workedHours.toFixed(1)}h worked + ${(scheduled?.remaining_hours ?? 0).toFixed(1)}h scheduled). Adjust schedule or get approval.`

          // Notify primary DM
          push(empInfo.manager_id, title, body, 'clock').catch(() => {})

          // Notify all DMs if floater
          if (empInfo.is_floater) {
            const allDms = await query<{ id: string }>(`
              SELECT id FROM users WHERE role = 'manager' AND is_active = TRUE AND id != $1 AND (is_hidden = FALSE OR is_hidden IS NULL)
            `, [empInfo.manager_id])
            for (const dm of allDms) {
              push(dm.id, title, body, 'clock').catch(() => {})
            }
          }

          // Notify SD if 45+ actual, Owner if 50+ actual
          if (workedHours >= 45) {
            const sds = await query<{ id: string }>(`SELECT id FROM users WHERE role = 'sales_director' AND is_active = TRUE`)
            for (const sd of sds) push(sd.id, `OT Alert: ${session.fullName} at ${workedHours.toFixed(1)}h${floaterTag}`, body, 'clock').catch(() => {})
          }
          if (workedHours >= 50) {
            const owners = await query<{ id: string }>(`SELECT id FROM users WHERE role = 'owner' AND is_active = TRUE`)
            for (const o of owners) push(o.id, `CRITICAL OT: ${session.fullName} at ${workedHours.toFixed(1)}h${floaterTag}`, body, 'clock').catch(() => {})
          }
        }
      } catch (err) {
        console.error('Clock-out OT check error:', err)
      }
    })()
  }

  // Generate AI end-of-day recap for DMs — awaited so Vercel doesn't kill the function
  if (session.role === 'manager' && session.org_id) {
    await sendDmEodRecap({
      dmId: session.id,
      dmName: session.fullName,
      dmEmail: session.email,
      orgId: session.org_id!,
      shiftId: shift.id,
    })
  }

  // Notify ops managers+ when a DM clocks out (respecting notification preferences)
  if (session.role === 'manager' && session.org_id) {
    const durationMs = Date.now() - new Date(shift.clock_in_at).getTime()
    const h = Math.floor(durationMs / 3600000)
    const m = Math.floor((durationMs % 3600000) / 60000)
    const durationStr = h > 0 ? `${h}h ${m}m` : `${m}m`
    const notifyUsers = await query<{ id: string }>(
      `SELECT u.id FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE u.role IN ('ops_manager','owner','sales_director','developer') AND u.is_active = TRUE AND u.org_id = $1
         AND COALESCE(np.dm_clockout_alerts, TRUE) = TRUE
         AND COALESCE(np.push_enabled, TRUE) = TRUE`,
      [session.org_id]
    )
    if (notifyUsers.length > 0) {
      sendPushToUsers(
        notifyUsers.map(u => u.id),
        'DM Clocked Out',
        `${session.fullName} clocked out after ${durationStr}`,
        'clock_out'
      ).catch(e => console.error('Clock-out async error:', e))
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
      ).catch(e => console.error('Clock-out async error:', e))
    }
  }

  return NextResponse.json({ ok: true })
}
