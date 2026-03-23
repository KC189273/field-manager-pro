import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { currentWeekStart, formatWeekRange } from '@/lib/schedule'

function weeklyReportHtml(
  weekRange: string,
  employees: {
    full_name: string
    total_hours: number
    shift_count: number
    days_scheduled: number[]
  }[]
): string {
  const rows = employees.map(e => {
    const hours = (e.total_hours / 3600).toFixed(1)
    const overtime = e.total_hours / 3600 > 40
    return `
      <tr style="border-bottom:1px solid #e5e5ea;">
        <td style="padding:10px 14px;font-size:14px;color:#1c1c1e;">${e.full_name}</td>
        <td style="padding:10px 14px;font-size:14px;text-align:center;">${e.shift_count}</td>
        <td style="padding:10px 14px;font-size:14px;text-align:center;color:${overtime ? '#e65100' : '#1c1c1e'};font-weight:${overtime ? '700' : '400'};">${hours}h${overtime ? ' ⚠' : ''}</td>
      </tr>
    `
  }).join('')

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:650px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Weekly Summary — ${weekRange}</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:20px 24px;">
        ${employees.length === 0
          ? '<p style="color:#8e8e93;font-size:14px;">No shifts recorded this week.</p>'
          : `<table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="background:#f2f2f7;">
                  <th style="padding:10px 14px;text-align:left;font-size:13px;color:#8e8e93;font-weight:600;">Employee</th>
                  <th style="padding:10px 14px;text-align:center;font-size:13px;color:#8e8e93;font-weight:600;">Shifts</th>
                  <th style="padding:10px 14px;text-align:center;font-size:13px;color:#8e8e93;font-weight:600;">Total Hours</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
        }
        <p style="font-size:12px;color:#8e8e93;margin:20px 0 0;">⚠ = Overtime (over 40 hours). Log in to Field Manager Pro to view detailed time history and maps.</p>
      </div>
    </div>
  `
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if weekly report is enabled
  const config = await queryOne<{ value: string }>(
    `SELECT value FROM dev_config WHERE key = 'weekly_report_enabled'`
  )
  if (config?.value === 'false') {
    return NextResponse.json({ ok: true, skipped: true })
  }

  // Get the week that just ended (previous week)
  const now = new Date()
  const thisWeekMonday = currentWeekStart(now)
  const lastWeekMonday = new Date(thisWeekMonday)
  lastWeekMonday.setDate(lastWeekMonday.getDate() - 7)
  const lastWeekSunday = new Date(thisWeekMonday)
  lastWeekSunday.setSeconds(lastWeekSunday.getSeconds() - 1)

  const weekRange = formatWeekRange(lastWeekMonday)

  // Aggregate hours per employee for last week
  const employees = await query<{
    full_name: string
    total_hours: number
    shift_count: number
  }>(`
    SELECT
      u.full_name,
      COUNT(s.id) AS shift_count,
      COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(s.clock_out_at, NOW()) - s.clock_in_at))), 0) AS total_hours
    FROM users u
    LEFT JOIN shifts s ON s.user_id = u.id
      AND s.clock_in_at >= $1
      AND s.clock_in_at < $2
    WHERE u.role = 'employee' AND u.is_active = TRUE
    GROUP BY u.id, u.full_name
    ORDER BY u.full_name
  `, [lastWeekMonday.toISOString(), thisWeekMonday.toISOString()])

  const html = weeklyReportHtml(weekRange, employees.map(e => ({
    ...e,
    total_hours: Number(e.total_hours),
    shift_count: Number(e.shift_count),
    days_scheduled: [],
  })))

  // Collect recipients: managers + ops_managers + developer if enabled
  const recipients = await query<{ email: string }>(
    `SELECT email FROM users WHERE role IN ('manager','ops_manager') AND is_active = TRUE`
  )

  const devConfig = await queryOne<{ value: string }>(
    `SELECT value FROM dev_config WHERE key = 'schedule_submit_notify_developer'`
  )
  if (devConfig?.value !== 'false') {
    const devs = await query<{ email: string }>(
      `SELECT email FROM users WHERE role = 'developer' AND is_active = TRUE`
    )
    recipients.push(...devs)
  }

  const emails = [...new Set(recipients.map(r => r.email))]
  const subject = `FMP Weekly Report — ${weekRange}`

  for (const email of emails) {
    await sendEmail(email, subject, html)
  }

  return NextResponse.json({ ok: true, sent: emails.length })
}
