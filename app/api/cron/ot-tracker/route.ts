import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'

// Runs 3x daily (11 AM, 5 PM, 10 PM CST) — checks employees trending toward OT
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Get current week boundaries (Mon-Sun)
    const now = new Date()
    const day = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
    monday.setHours(0, 0, 0, 0)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    sunday.setHours(23, 59, 59, 999)
    const weekStart = monday.toISOString().split('T')[0]
    const weekEnd = sunday.toISOString().split('T')[0]

    // Get all active employees with their DM and floater status
    const employees = await query<{
      id: string; full_name: string; manager_id: string | null; is_floater: boolean
    }>(`
      SELECT id, full_name, manager_id, COALESCE(is_floater, false) as is_floater
      FROM users
      WHERE role = 'employee' AND is_active = TRUE AND (is_hidden = FALSE OR is_hidden IS NULL)
    `)

    // For each employee, calculate hours worked + remaining scheduled hours
    const alerts: Array<{
      employee_id: string; employee_name: string; manager_id: string
      worked_hours: number; scheduled_remaining: number; projected_hours: number
      is_floater: boolean
    }> = []

    for (const emp of employees) {
      if (!emp.manager_id) continue

      // Hours worked this week (net of breaks)
      const worked = await query<{ net_hours: number }>(`
        SELECT COALESCE(SUM(
          EXTRACT(EPOCH FROM (COALESCE(s.clock_out_at, NOW()) - s.clock_in_at))
          - COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (b.break_end - b.break_start)))
                      FROM shift_breaks b WHERE b.shift_id = s.id AND b.break_end IS NOT NULL), 0)
        ) / 3600, 0)::float as net_hours
        FROM shifts s
        WHERE s.user_id = $1
          AND s.clock_in_at >= $2
          AND s.clock_in_at <= $3
      `, [emp.id, weekStart, weekEnd + 'T23:59:59'])

      const workedHours = worked[0].net_hours

      // Remaining scheduled hours this week (future shifts only)
      const today = now.toISOString().split('T')[0]
      const scheduled = await query<{ remaining_hours: number }>(`
        SELECT COALESCE(SUM(
          EXTRACT(EPOCH FROM (
            (shift_date + end_time) - (shift_date + start_time)
          )) / 3600
          - COALESCE(break_minutes, 0) / 60.0
        ), 0)::float as remaining_hours
        FROM scheduled_shifts
        WHERE employee_id = $1
          AND shift_date > $2
          AND shift_date <= $3
          AND EXISTS (
            SELECT 1 FROM scheduled_shifts_publish ssp
            WHERE ssp.store_location_id = scheduled_shifts.store_location_id
              AND ssp.week_start = scheduled_shifts.shift_date - ((EXTRACT(DOW FROM scheduled_shifts.shift_date)::int + 6) % 7)
          )
      `, [emp.id, today, weekEnd])

      const scheduledRemaining = scheduled[0].remaining_hours
      const projected = workedHours + scheduledRemaining

      // Alert if trending toward 45+
      if (projected >= 45) {
        alerts.push({
          employee_id: emp.id,
          employee_name: emp.full_name,
          manager_id: emp.manager_id,
          worked_hours: workedHours,
          scheduled_remaining: scheduledRemaining,
          projected_hours: projected,
          is_floater: emp.is_floater,
        })
      }
    }

    // Group alerts by DM and send push notifications
    const byDm = new Map<string, typeof alerts>()
    for (const alert of alerts) {
      if (!byDm.has(alert.manager_id)) byDm.set(alert.manager_id, [])
      byDm.get(alert.manager_id)!.push(alert)
    }

    // For floaters, also notify ALL DMs in the org (not just their assigned manager)
    const floaterAlerts = alerts.filter(a => a.is_floater)
    if (floaterAlerts.length > 0) {
      const allDms = await query<{ id: string }>(`
        SELECT id FROM users WHERE role = 'manager' AND is_active = TRUE AND (is_hidden = FALSE OR is_hidden IS NULL)
      `)
      for (const dm of allDms) {
        for (const fa of floaterAlerts) {
          if (fa.manager_id === dm.id) continue // already notified as primary DM
          if (!byDm.has(dm.id)) byDm.set(dm.id, [])
          // Avoid duplicates
          if (!byDm.get(dm.id)!.find(a => a.employee_id === fa.employee_id)) {
            byDm.get(dm.id)!.push(fa)
          }
        }
      }
    }

    let notificationsSent = 0
    for (const [dmId, dmAlerts] of byDm) {
      for (const alert of dmAlerts) {
        const level = alert.projected_hours >= 50 ? 'OWNER APPROVAL NEEDED' :
                      alert.projected_hours >= 45 ? 'SD APPROVAL NEEDED' : 'OT ALERT'
        const floaterTag = alert.is_floater ? ' [FLOATER]' : ''
        const title = `${level}: ${alert.employee_name}${floaterTag}`
        const body = `Projected ${alert.projected_hours.toFixed(1)}h this week (${alert.worked_hours.toFixed(1)}h worked + ${alert.scheduled_remaining.toFixed(1)}h scheduled). Adjust schedule or get approval.`

        await sendPushToUser(dmId, title, body, 'clock').catch(e =>
          console.error('OT tracker push error:', e)
        )
        notificationsSent++
      }
    }

    // Also notify SD for 45+ actuals and Owner for 50+ actuals
    const actualOt45 = alerts.filter(a => a.worked_hours >= 45)
    const actualOt50 = alerts.filter(a => a.worked_hours >= 50)

    if (actualOt45.length > 0) {
      const sds = await query<{ id: string }>(`
        SELECT id FROM users WHERE role = 'sales_director' AND is_active = TRUE
      `)
      for (const sd of sds) {
        for (const a of actualOt45) {
          const title = `OT Alert: ${a.employee_name} at ${a.worked_hours.toFixed(1)}h${a.is_floater ? ' [FLOATER]' : ''}`
          const body = `Has already worked ${a.worked_hours.toFixed(1)} hours this week. ${a.worked_hours >= 50 ? 'Owner approval required.' : 'SD approval required.'}`
          await sendPushToUser(sd.id, title, body, 'clock').catch(() => {})
        }
      }
    }

    if (actualOt50.length > 0) {
      const owners = await query<{ id: string }>(`
        SELECT id FROM users WHERE role = 'owner' AND is_active = TRUE
      `)
      for (const owner of owners) {
        for (const a of actualOt50) {
          const title = `CRITICAL OT: ${a.employee_name} at ${a.worked_hours.toFixed(1)}h${a.is_floater ? ' [FLOATER]' : ''}`
          const body = `Has worked ${a.worked_hours.toFixed(1)} hours this week. Owner approval required for 50+ hours.`
          await sendPushToUser(owner.id, title, body, 'clock').catch(() => {})
        }
      }
    }

    return NextResponse.json({
      ok: true,
      employeesChecked: employees.length,
      alertsTriggered: alerts.length,
      notificationsSent,
    })
  } catch (err) {
    console.error('OT tracker error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
