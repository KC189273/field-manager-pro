import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'

// Runs every 15 minutes — detects employees whose GPS went silent while clocked in
// If GPS has been dark for 5+ minutes, auto clock them out
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Find employees clocked in with no GPS breadcrumb in the last 30 minutes
    // Only check employees (not DMs/leadership) who have a store assigned
    const silent = await query<{
      shift_id: string; user_id: string; user_name: string
      manager_id: string | null; store_location_id: string | null
      clock_in_at: string; last_breadcrumb: string | null
    }>(`
      SELECT s.id as shift_id, s.user_id, u.full_name as user_name,
        u.manager_id, s.store_location_id,
        s.clock_in_at::text,
        (SELECT MAX(g.recorded_at)::text FROM gps_breadcrumbs g WHERE g.shift_id = s.id) as last_breadcrumb
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      WHERE s.clock_out_at IS NULL
        AND s.clock_in_at IS NOT NULL
        AND u.role = 'employee'
        AND s.store_location_id IS NOT NULL
        AND (
          -- No breadcrumb at all in 5+ minutes, OR no breadcrumbs ever for this shift
          NOT EXISTS (
            SELECT 1 FROM gps_breadcrumbs g
            WHERE g.shift_id = s.id AND g.recorded_at > NOW() - INTERVAL '5 minutes'
          )
        )
        AND s.clock_in_at < NOW() - INTERVAL '5 minutes'
    `)

    if (!silent.length) {
      return NextResponse.json({ ok: true, clocked_out: 0, checked: 0 })
    }

    let clockedOut = 0
    const todayCST = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

    for (const emp of silent) {
      // Determine clock-out time: use last breadcrumb time if available, otherwise NOW
      const clockOutTime = emp.last_breadcrumb
        ? new Date(emp.last_breadcrumb)
        : new Date()

      // Close any open breaks
      await query(`UPDATE shift_breaks SET break_end = $1 WHERE shift_id = $2 AND break_end IS NULL`,
        [clockOutTime.toISOString(), emp.shift_id]).catch(() => {})

      // Clock out
      await query(`
        UPDATE shifts SET clock_out_at = $1,
          clock_out_address = 'Auto clock-out: GPS signal lost'
        WHERE id = $2 AND clock_out_at IS NULL`,
        [clockOutTime.toISOString(), emp.shift_id]
      )

      // Create flag (skip if one already exists)
      const existingFlag = await queryOne(`SELECT id FROM flags WHERE shift_id = $1 AND type = 'auto_clock_out' LIMIT 1`, [emp.shift_id]).catch(() => null)
      if (!existingFlag) {
        const minutesSilent = emp.last_breadcrumb
          ? Math.round((Date.now() - new Date(emp.last_breadcrumb).getTime()) / 60000)
          : Math.round((Date.now() - new Date(emp.clock_in_at).getTime()) / 60000)
        await query(`
          INSERT INTO flags (user_id, shift_id, type, date, detail, store_location_id)
          VALUES ($1, $2, 'auto_clock_out', $3, $4, $5)`,
          [emp.user_id, emp.shift_id, todayCST,
           `${emp.user_name} was auto clocked out — GPS signal lost for ${minutesSilent} minutes. Last GPS: ${emp.last_breadcrumb ? new Date(emp.last_breadcrumb).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) : 'none'}.`,
           emp.store_location_id]
        ).catch(() => {})
      }

      // Notify employee
      sendPushToUser(emp.user_id, 'Auto Clock-Out',
        'You were clocked out because the app was closed or GPS was turned off. Keep the app open and GPS enabled during your shift.',
        'geofence'
      ).catch(() => {})

      // Notify DM
      if (emp.manager_id) {
        sendPushToUser(emp.manager_id, 'Employee App Closed',
          `${emp.user_name} was auto clocked out — app closed or GPS turned off.`,
          'flag_created'
        ).catch(() => {})
      }

      clockedOut++
    }

    return NextResponse.json({ ok: true, clocked_out: clockedOut, checked: silent.length })
  } catch (err) {
    console.error('GPS silence check error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
