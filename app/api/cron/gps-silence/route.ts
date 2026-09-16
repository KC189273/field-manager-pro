import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'
import { sendEmail } from '@/lib/notifications'

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
      shift_id: string; user_id: string; user_name: string; user_email: string
      manager_id: string | null; manager_email: string | null; manager_name: string | null
      store_location_id: string | null; store_address: string | null
      clock_in_at: string; last_breadcrumb: string | null
    }>(`
      SELECT s.id as shift_id, s.user_id, u.full_name as user_name, u.email as user_email,
        u.manager_id, m.email as manager_email, m.full_name as manager_name,
        s.store_location_id, dsl.address as store_address,
        s.clock_in_at::text,
        (SELECT MAX(g.recorded_at)::text FROM gps_breadcrumbs g WHERE g.shift_id = s.id) as last_breadcrumb
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN users m ON m.id = u.manager_id
      LEFT JOIN dm_store_locations dsl ON dsl.id = s.store_location_id
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

      // Notify employee — push + email
      sendPushToUser(emp.user_id, 'Auto Clock-Out',
        'You were clocked out because the app was closed or GPS was turned off. Keep the app open and GPS enabled during your shift.',
        'geofence'
      ).catch(() => {})

      const clockOutFmt = clockOutTime.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
      const storeName = emp.store_address?.split(',')[0] || 'your store'

      if (emp.user_email) {
        sendEmail(emp.user_email, `Auto Clock-Out — App Closed or GPS Off`,
          `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:#991b1b;padding:20px 24px;border-radius:12px 12px 0 0;">
              <h1 style="color:white;margin:0;font-size:18px;">Auto Clock-Out</h1>
            </div>
            <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;background:white;border-radius:0 0 12px 12px;">
              <p style="font-size:14px;color:#374151;margin:0 0 12px;">Hi ${emp.user_name},</p>
              <p style="font-size:14px;color:#374151;margin:0 0 12px;">You were automatically clocked out at <strong>${clockOutFmt}</strong> from <strong>${storeName}</strong> because the Field Manager Pro app was closed or your GPS was turned off.</p>
              <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin:0 0 16px;">
                <p style="font-size:13px;color:#991b1b;margin:0;font-weight:600;">Reminder: Keep the app open and GPS enabled during your entire shift.</p>
              </div>
              <p style="font-size:13px;color:#6b7280;margin:0;">If you were still working, please contact your DM to correct your time.</p>
            </div>
          </div>`,
          undefined,
          { userId: emp.user_id, category: 'gps_silence_clockout' }
        ).catch(() => {})
      }

      // Notify DM — push + email
      if (emp.manager_id) {
        sendPushToUser(emp.manager_id, 'Employee App Closed',
          `${emp.user_name} was auto clocked out — app closed or GPS turned off.`,
          'flag_created'
        ).catch(() => {})

        if (emp.manager_email) {
          sendEmail(emp.manager_email, `Auto Clock-Out — ${emp.user_name} (App Closed / GPS Off)`,
            `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#991b1b;padding:20px 24px;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;font-size:18px;">Employee Auto Clock-Out</h1>
                <p style="color:#fecaca;margin:4px 0 0;font-size:13px;">${emp.user_name} — ${storeName}</p>
              </div>
              <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;background:white;border-radius:0 0 12px 12px;">
                <p style="font-size:14px;color:#374151;margin:0 0 12px;"><strong>${emp.user_name}</strong> was automatically clocked out at <strong>${clockOutFmt}</strong> because the app was closed or GPS was turned off.</p>
                <p style="font-size:13px;color:#6b7280;margin:0 0 12px;">If this employee was still working, you will need to manually correct their time in Timecards.</p>
                <p style="font-size:13px;color:#6b7280;margin:0;">Please address this with the employee — they must keep the app open and GPS enabled during their shift.</p>
              </div>
            </div>`,
            undefined,
            { userId: emp.manager_id, category: 'gps_silence_clockout' }
          ).catch(() => {})
        }
      }

      clockedOut++
    }

    return NextResponse.json({ ok: true, clocked_out: clockedOut, checked: silent.length })
  } catch (err) {
    console.error('GPS silence check error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
