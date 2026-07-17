import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/apns'

const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
const ANCHOR = new Date('2026-03-30T12:00:00.000Z')

function isPayPeriodEndDate(): { isEnd: boolean; periodStart: string; periodEnd: string } {
  const now = new Date()
  const cstDate = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const daysSince = Math.floor((new Date(cstDate + 'T12:00:00Z').getTime() - ANCHOR.getTime()) / 86400000)
  const currentPeriodIdx = Math.floor(daysSince / 14)
  const periodStart = new Date(ANCHOR)
  periodStart.setUTCDate(periodStart.getUTCDate() + currentPeriodIdx * 14)
  const periodEnd = new Date(periodStart)
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 13)

  const endStr = periodEnd.toISOString().split('T')[0]
  return {
    isEnd: cstDate === endStr,
    periodStart: periodStart.toISOString().split('T')[0],
    periodEnd: endStr,
  }
}

function fmtPeriod(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const e = new Date(end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${s} – ${e}`
}

// Runs every Sunday at 10:15 PM CST (4:15 UTC) — after auto-clockout
// On pay period end Sundays: notifies DMs to review and submit their timecards
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { isEnd, periodStart, periodEnd } = isPayPeriodEndDate()
  if (!isEnd) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'Not a pay period end date' })
  }

  const periodLabel = fmtPeriod(periodStart, periodEnd)

  // Find all orgs with payroll active
  const orgs = await query<{ id: string; name: string }>(`
    SELECT id, name FROM organizations
    WHERE payroll_launch_date IS NOT NULL AND payroll_launch_date <= CURRENT_DATE
  `)

  let totalNotified = 0

  for (const org of orgs) {
    // Ensure the period exists
    await queryOne(`
      INSERT INTO payroll_periods (org_id, period_start, period_end, status)
      VALUES ($1, $2, $3, 'pending_dm')
      ON CONFLICT (org_id, period_start) DO NOTHING
    `, [org.id, periodStart, periodEnd])

    const period = await queryOne<{ id: string }>(`
      SELECT id FROM payroll_periods WHERE org_id = $1 AND period_start = $2
    `, [org.id, periodStart])
    if (!period) continue

    // Find all active DMs with employees who haven't submitted yet
    const dms = await query<{ id: string; full_name: string; email: string }>(`
      SELECT u.id, u.full_name, u.email FROM users u
      WHERE u.org_id = $1 AND u.role = 'manager' AND u.is_active = TRUE
        AND (u.is_hidden = FALSE OR u.is_hidden IS NULL)
        AND EXISTS (
          SELECT 1 FROM users e WHERE e.manager_id = u.id AND e.role = 'employee' AND e.is_active = TRUE
        )
        AND NOT EXISTS (
          SELECT 1 FROM payroll_dm_approvals pda WHERE pda.period_id = $2 AND pda.dm_id = u.id
        )
    `, [org.id, period.id])

    for (const dm of dms) {
      // Push notification
      sendPushToUser(
        dm.id,
        'Payroll — Submit by Monday Noon',
        `Pay period ${periodLabel} has closed. Review your team's hours and submit timecards by Monday at noon CST.`,
        'payroll'
      ).catch(() => {})

      // Email
      sendEmail(
        dm.email,
        `Action Required: Submit Timecards by Monday Noon — ${periodLabel}`,
        `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Payroll Submission Required</p>
          </div>
          <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
            <p style="font-size:14px;color:#555;margin:0 0 12px;">Hi ${dm.full_name.split(' ')[0]},</p>
            <p style="font-size:14px;color:#555;margin:0 0 12px;">The pay period <strong>${periodLabel}</strong> has closed. Please review your team's hours and <strong>lock &amp; submit your timecards</strong>.</p>
            <div style="background:#fff3e0;border-radius:10px;padding:14px 18px;margin-bottom:16px;">
              <p style="font-size:13px;font-weight:600;color:#e65100;margin:0;">Deadline: Monday at noon CST</p>
            </div>
            <p style="font-size:14px;color:#555;margin:0 0 16px;">Once you submit, your SD will review and approve your payroll.</p>
            <a href="${APP_URL}/payroll" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">Review & Submit Timecards</a>
          </div>
        </div>`
      ).catch(() => {})

      totalNotified++
    }
  }

  return NextResponse.json({ ok: true, totalNotified, period: periodLabel })
}
