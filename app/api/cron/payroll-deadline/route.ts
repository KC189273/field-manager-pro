import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/apns'

const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
const ANCHOR = new Date('2026-03-30T12:00:00.000Z')

function getLastClosedPeriod(): { start: string; end: string } | null {
  const now = new Date()
  const daysSince = Math.floor((now.getTime() - ANCHOR.getTime()) / 86400000)
  const currentPeriodIdx = Math.floor(daysSince / 14)
  if (currentPeriodIdx < 1) return null
  const closedIdx = currentPeriodIdx - 1
  const start = new Date(ANCHOR)
  start.setUTCDate(start.getUTCDate() + closedIdx * 14)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 13)
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
}

function fmtPeriod(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const e = new Date(end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${s} – ${e}`
}

// Runs Monday at noon CST (18:00 UTC)
// Auto-submits timecards for any DMs who missed the deadline, then escalates to SD + owner
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const closed = getLastClosedPeriod()
  if (!closed) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'No closed period' })
  }

  const { start, end } = closed
  const periodLabel = fmtPeriod(start, end)

  // Find orgs with active payroll
  const orgs = await query<{ id: string; name: string }>(`
    SELECT id, name FROM organizations
    WHERE payroll_launch_date IS NOT NULL AND payroll_launch_date <= CURRENT_DATE
  `)

  let totalAutoSubmitted = 0
  const results: Array<{ org: string; missedDms: string[] }> = []

  for (const org of orgs) {
    const period = await queryOne<{ id: string; status: string }>(`
      SELECT id, status FROM payroll_periods
      WHERE org_id = $1 AND period_start = $2
    `, [org.id, start])

    if (!period || period.status === 'approved') continue

    // Find DMs who haven't submitted
    const missedDms = await query<{ id: string; full_name: string; email: string }>(`
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

    if (missedDms.length === 0) continue

    const missedNames: string[] = []

    // Auto-submit for each missed DM
    for (const dm of missedDms) {
      await queryOne(`
        INSERT INTO payroll_dm_approvals (period_id, dm_id)
        VALUES ($1, $2)
        ON CONFLICT (period_id, dm_id) DO NOTHING
      `, [period.id, dm.id])

      missedNames.push(dm.full_name)
      totalAutoSubmitted++

      // Notify the DM they missed the deadline
      sendPushToUser(
        dm.id,
        'Payroll Deadline Missed',
        `You did not submit timecards for ${periodLabel} by the noon deadline. They have been auto-submitted for SD review.`,
        'payroll'
      ).catch(() => {})

      sendEmail(
        dm.email,
        `[MISSED DEADLINE] Timecards Auto-Submitted — ${periodLabel}`,
        `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <div style="background:#dc2626;padding:20px 24px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Payroll Deadline Missed</p>
          </div>
          <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
            <p style="font-size:14px;color:#555;margin:0 0 12px;">Hi ${dm.full_name.split(' ')[0]},</p>
            <p style="font-size:14px;color:#555;margin:0 0 12px;">You did not submit your timecards for <strong>${periodLabel}</strong> by the <strong>Monday noon CST</strong> deadline.</p>
            <p style="font-size:14px;color:#555;margin:0 0 12px;">Your timecards have been <strong>automatically submitted</strong> and sent to your SD for review. Your SD and ownership have been notified of the missed deadline.</p>
            <p style="font-size:13px;color:#dc2626;font-weight:600;margin:0;">Please ensure timely submission going forward.</p>
          </div>
        </div>`
      ).catch(() => {})
    }

    // Escalate to SD
    const sds = await query<{ id: string; email: string; full_name: string }>(`
      SELECT id, email, full_name FROM users
      WHERE org_id = $1 AND role = 'sales_director' AND is_active = TRUE
    `, [org.id])

    const dmList = missedNames.map(n => `<li style="font-size:14px;color:#dc2626;font-weight:600;margin:4px 0">${n}</li>`).join('')

    for (const sd of sds) {
      sendPushToUser(
        sd.id,
        `Payroll: ${missedNames.length} DM${missedNames.length !== 1 ? 's' : ''} Missed Deadline`,
        `${missedNames.join(', ')} did not submit timecards by noon. Auto-submitted for your review.`,
        'payroll'
      ).catch(() => {})

      sendEmail(
        sd.email,
        `[ESCALATION] ${missedNames.length} DM${missedNames.length !== 1 ? 's' : ''} Missed Payroll Deadline — ${periodLabel}`,
        `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <div style="background:#dc2626;padding:20px 24px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Payroll Deadline Escalation</p>
          </div>
          <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
            <p style="font-size:14px;color:#555;margin:0 0 12px;">Hi ${sd.full_name},</p>
            <p style="font-size:14px;color:#555;margin:0 0 12px;">The following DM${missedNames.length !== 1 ? 's' : ''} did not submit timecards for <strong>${periodLabel}</strong> by the Monday noon deadline:</p>
            <ul style="margin:0 0 16px;padding-left:20px">${dmList}</ul>
            <p style="font-size:14px;color:#555;margin:0 0 16px;">Their timecards have been <strong>auto-submitted</strong> and are ready for your review. Please verify their hours are correct before approving.</p>
            <a href="${APP_URL}/payroll" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">Review Payroll</a>
          </div>
        </div>`
      ).catch(() => {})
    }

    // Escalate to owners
    const owners = await query<{ id: string; email: string; full_name: string }>(`
      SELECT id, email, full_name FROM users
      WHERE org_id = $1 AND role = 'owner' AND is_active = TRUE
    `, [org.id])

    for (const owner of owners) {
      sendPushToUser(
        owner.id,
        `Payroll: ${missedNames.length} DM${missedNames.length !== 1 ? 's' : ''} Missed Deadline`,
        `${missedNames.join(', ')} missed the payroll submission deadline for ${periodLabel}. Auto-submitted.`,
        'payroll'
      ).catch(() => {})

      sendEmail(
        owner.email,
        `[FYI] Payroll Deadline Missed — ${missedNames.length} DM${missedNames.length !== 1 ? 's' : ''} — ${periodLabel}`,
        `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Payroll Deadline Report</p>
          </div>
          <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
            <p style="font-size:14px;color:#555;margin:0 0 12px;">Hi ${owner.full_name},</p>
            <p style="font-size:14px;color:#555;margin:0 0 12px;">The following DM${missedNames.length !== 1 ? 's' : ''} missed the noon deadline for <strong>${periodLabel}</strong>:</p>
            <ul style="margin:0 0 16px;padding-left:20px">${dmList}</ul>
            <p style="font-size:14px;color:#555;margin:0;">Their timecards were auto-submitted. ${sds.length > 0 ? `${sds[0].full_name} has been notified to review.` : 'SD has been notified to review.'}</p>
          </div>
        </div>`
      ).catch(() => {})
    }

    results.push({ org: org.name, missedDms: missedNames })
  }

  return NextResponse.json({ ok: true, totalAutoSubmitted, results })
}
