import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

const CST = 'America/Chicago'

// Runs daily at 9:30 PM CST — sends uniform compliance summary to DMs + CC leadership
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: CST })

  const orgs = await query<{ id: string; name: string }>(`SELECT id, name FROM organizations WHERE industry = 'wireless_retail'`)

  let totalEmails = 0

  for (const org of orgs) {
    // Today's uniform check results grouped by DM
    const dmResults = await query<{
      dm_id: string; dm_name: string; dm_email: string
      total: number; failed: number
      failed_employees: string
    }>(`
      SELECT u.manager_id as dm_id, m.full_name as dm_name, m.email as dm_email,
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE uc.result = 'fail')::int as failed,
        STRING_AGG(CASE WHEN uc.result = 'fail' THEN u.full_name || ' (' || uc.details || ')' END, '\n') as failed_employees
      FROM uniform_checks uc
      JOIN users u ON u.id = uc.user_id
      LEFT JOIN users m ON m.id = u.manager_id
      WHERE (uc.created_at AT TIME ZONE 'America/Chicago')::date = $1::date
        AND u.org_id = $2
        AND uc.result != 'skipped'
      GROUP BY u.manager_id, m.full_name, m.email
      HAVING COUNT(*) FILTER (WHERE uc.result = 'fail') > 0
      ORDER BY failed DESC
    `, [today, org.id])

    if (dmResults.length === 0) continue

    // Get leadership emails for CC
    const leadership = await query<{ email: string }>(`
      SELECT email FROM users
      WHERE org_id = $1 AND is_active = TRUE
        AND role IN ('ops_manager', 'owner', 'developer')
    `, [org.id])
    const ccEmails = leadership.map(l => l.email)

    // Send individual email to each DM with violations
    for (const dm of dmResults) {
      if (!dm.dm_email) continue

      const failedList = (dm.failed_employees || '').split('\n').filter(Boolean)

      const employeeRows = failedList.map(emp => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;">${emp}</td>
        </tr>
      `).join('')

      const html = `
        <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <div style="background:#dc2626;padding:20px 24px;border-radius:12px 12px 0 0;">
            <h1 style="color:white;margin:0;font-size:18px;">Uniform Compliance Report</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">${new Date().toLocaleDateString('en-US', { timeZone: CST, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>
          <div style="background:white;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;padding:24px;">
            <p style="font-size:15px;color:#1f2937;">Hi ${dm.dm_name},</p>
            <p style="font-size:14px;color:#374151;">The following employees on your team were flagged for uniform non-compliance today:</p>

            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <tr style="background:#fef2f2;">
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#991b1b;text-transform:uppercase;">Employee &amp; Issue</th>
              </tr>
              ${employeeRows}
            </table>

            <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;margin:20px 0;">
              <p style="font-size:14px;color:#991b1b;font-weight:700;margin:0 0 8px;">Action Required</p>
              <p style="font-size:13px;color:#374151;margin:0 0 8px;line-height:1.6;">You are required to have a <strong>voice-to-voice conversation</strong> with each employee listed above regarding uniform expectations. Once completed, notify <strong>Danielle</strong> that the conversations have taken place and <strong>document the conversation</strong> in Field Manager Pro using Accountability &rarr; Documented Conversation.</p>
              <p style="font-size:13px;color:#991b1b;margin:0;line-height:1.6;font-weight:600;">Failure to address uniform violations with your team may result in increasing levels of accountability for the DM.</p>
            </div>

            <p style="font-size:12px;color:#6b7280;margin-top:16px;">Total photos checked today: ${dm.total} | Violations found: ${dm.failed}</p>
          </div>
        </div>
      `

      // Send to DM, CC leadership
      sendEmail(
        [dm.dm_email, ...ccEmails],
        `Uniform Violations — ${dm.failed} Employee${dm.failed > 1 ? 's' : ''} Flagged — ${today}`,
        html
      ).catch(() => {})
      totalEmails++
    }
  }

  return NextResponse.json({ ok: true, emails: totalEmails })
}
