import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

function buildCadenceEmailHtml(): string {
  const check = `<span style="color:#16a34a;font-weight:700;">✓</span>`
  const dash  = `<span style="color:#d1d5db;">—</span>`

  const row = (
    time: string,
    email: string,
    desc: string,
    dm: string, ops: string, sd: string, owner: string, dev: string
  ) => `
    <tr style="border-bottom:1px solid #f3f4f6;">
      <td style="padding:10px 12px;font-size:12px;color:#6b7280;white-space:nowrap;">${time}</td>
      <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#111827;">${email}</td>
      <td style="padding:10px 12px;font-size:12px;color:#374151;line-height:1.5;">${desc}</td>
      <td style="padding:10px 12px;text-align:center;">${dm}</td>
      <td style="padding:10px 12px;text-align:center;">${ops}</td>
      <td style="padding:10px 12px;text-align:center;">${sd}</td>
      <td style="padding:10px 12px;text-align:center;">${owner}</td>
      <td style="padding:10px 12px;text-align:center;">${dev}</td>
    </tr>`

  const sectionHeader = (label: string) => `
    <tr>
      <td colspan="8" style="padding:14px 12px 6px;background:#f9fafb;border-top:2px solid #e5e7eb;">
        <span style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;">${label}</span>
      </td>
    </tr>`

  const sdNote = `<span style="font-size:11px;color:#7c3aed;">(summary)</span>`
  const devNote = `<span style="font-size:11px;color:#6b7280;">(if enabled)</span>`
  const orgNote = `<span style="font-size:11px;color:#6b7280;">(org)</span>`
  const allNote = `<span style="font-size:11px;color:#6b7280;">(all orgs)</span>`
  const ownTeam = `<span style="font-size:11px;color:#6b7280;">(own team)</span>`

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
<tr><td align="center">
<table width="780" cellpadding="0" cellspacing="0" style="max-width:780px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">

  <!-- Header -->
  <tr><td style="background:#7c3aed;padding:28px 40px;">
    <p style="color:rgba(255,255,255,0.7);font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 0 6px;font-family:'Arial',sans-serif;">Field Manager Pro</p>
    <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0;font-family:'Arial',sans-serif;">Automated Email Cadence Report</h1>
    <p style="color:rgba(255,255,255,0.75);font-size:13px;margin:8px 0 0;font-family:'Arial',sans-serif;">A complete breakdown of every scheduled email — what it contains, when it sends, and who receives it.</p>
  </td></tr>

  <!-- Intro -->
  <tr><td style="padding:28px 40px 16px;">
    <p style="font-size:14px;color:#374151;line-height:1.7;margin:0;font-family:'Arial',sans-serif;">
      Field Manager Pro sends automated emails on two cadences: <strong>daily</strong> and <strong>weekly</strong>. All times are <strong>Central Standard Time (CST)</strong>.
      The table below shows every scheduled email, a description of its contents, and which roles receive it.
    </p>
  </td></tr>

  <!-- Legend -->
  <tr><td style="padding:0 40px 20px;">
    <div style="background:#f9fafb;border-radius:8px;padding:12px 16px;display:inline-block;">
      <p style="font-size:12px;color:#6b7280;margin:0;font-family:'Arial',sans-serif;">
        <strong style="color:#16a34a;">✓</strong> = receives &nbsp;&nbsp;
        <strong style="color:#d1d5db;">—</strong> = not included &nbsp;&nbsp;
        <span style="color:#7c3aed;">(summary)</span> = receives a digest summary, not individual DM emails &nbsp;&nbsp;
        <span style="color:#6b7280;">(if enabled)</span> = controlled by dev config toggle
      </p>
    </div>
  </td></tr>

  <!-- Table -->
  <tr><td style="padding:0 40px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:'Arial',sans-serif;">

      <!-- Column headers -->
      <tr style="background:#f9fafb;">
        <th style="padding:10px 12px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">Time (CST)</th>
        <th style="padding:10px 12px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">Email</th>
        <th style="padding:10px 12px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">What's Inside</th>
        <th style="padding:10px 12px;font-size:11px;color:#6b7280;text-align:center;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">DM</th>
        <th style="padding:10px 12px;font-size:11px;color:#6b7280;text-align:center;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">Ops Mgr</th>
        <th style="padding:10px 12px;font-size:11px;color:#6b7280;text-align:center;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">Sales Dir</th>
        <th style="padding:10px 12px;font-size:11px;color:#6b7280;text-align:center;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">Owner</th>
        <th style="padding:10px 12px;font-size:11px;color:#6b7280;text-align:center;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">Developer</th>
      </tr>

      ${sectionHeader('Daily — Every Day')}

      ${row(
        '4:00 AM',
        'Weekly Report',
        'Schedule compliance summary: how many employees have submitted schedules, how many are missing, and which DMs are non-compliant. Sent every day.',
        check, check, check, check, `${check}<br>${devNote}`
      )}
      ${row(
        '6:00 AM',
        'Morning Digest',
        'Real-time snapshot of the day. DMs get their own team\'s data (employees clocked in, open supply requests, open facility tickets). Ops/SD/Owner get an org-wide consolidated summary across all DMs.',
        `${check}<br>${ownTeam}`, `${check}<br>${orgNote}`, `${check}<br>${orgNote}`, `${check}<br>${orgNote}`, dash
      )}
      ${row(
        '8:00 AM',
        'Task Reminder',
        'Sent only to users with overdue tasks that have not been completed. Each recipient gets an individual email for each overdue task assigned to them.',
        check, check, check, check, check
      )}

      ${sectionHeader('Weekly — Monday')}

      ${row(
        'Mon 7:00 AM',
        'Schedule Submission Reminder',
        'Reminds each DM (who has a store assigned) to submit staff schedules for 2 weeks out. SD receives a summary listing which DMs in their org were sent the reminder.',
        check, dash, `${check}<br>${sdNote}`, dash, dash
      )}
      ${row(
        'Mon 8:00 AM',
        'Payroll Approval Reminder',
        'Reminds DMs who have not yet submitted timecard approvals for the last closed pay period. Also creates a task in the app. SD receives a summary listing which DMs in their org still need to submit.',
        check, dash, `${check}<br>${sdNote}`, dash, dash
      )}
      ${row(
        'Mon 9:00 AM',
        'Payroll Report (Excel)',
        'Full payroll spreadsheet attached (3 tabs: Payroll Summary with hourly rates & estimated pay, Time Detail, PTO & Sick). Each org recipient gets their org\'s data only. Developer receives all orgs combined.',
        dash, `${check}<br>${orgNote}`, `${check}<br>${orgNote}`, `${check}<br>${orgNote}`, `${check}<br>${allNote}`
      )}
      ${row(
        'Mon 10:00 AM',
        'Roster Check Task + Email',
        'Assigns each DM a "Check Roster for Accuracy" task and sends an email prompt. SD receives a summary listing which DMs in their org were assigned the task.',
        check, dash, `${check}<br>${sdNote}`, dash, dash
      )}

      ${sectionHeader('Weekly — Wednesday')}

      ${row(
        'Wed 10:00 AM',
        'Weekend Plan Task + Email',
        'Assigns each DM a "Discuss Weekend Plan w/ RDM" task (due 8:00 PM CST) and sends an email prompt. SD receives a summary listing which DMs in their org were assigned the task.',
        check, dash, `${check}<br>${sdNote}`, dash, dash
      )}

    </table>
  </td></tr>

  <!-- Notes section -->
  <tr><td style="padding:0 40px 32px;">
    <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:16px 20px;">
      <p style="font-size:13px;font-weight:700;color:#92400e;margin:0 0 8px;font-family:'Arial',sans-serif;">Notes</p>
      <ul style="margin:0;padding-left:18px;font-family:'Arial',sans-serif;">
        <li style="font-size:13px;color:#78350f;line-height:1.7;margin-bottom:4px;">All times are CST. Cron jobs run in UTC — times shown are the CST equivalent.</li>
        <li style="font-size:13px;color:#78350f;line-height:1.7;margin-bottom:4px;">SD summary emails only fire if at least one DM in their org was contacted. If no DMs were eligible, no SD summary is sent.</li>
        <li style="font-size:13px;color:#78350f;line-height:1.7;margin-bottom:4px;">The Payroll Report (Mon 9AM) sends org-specific data. Ops Managers now receive this report in addition to Sales Directors and Owners.</li>
        <li style="font-size:13px;color:#78350f;line-height:1.7;">The Weekly Report (4AM daily) Developer toggle is controlled via the dev config panel in the app.</li>
      </ul>
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 40px;">
    <p style="font-size:11px;color:#9ca3af;margin:0;font-family:'Arial',sans-serif;">
      Generated by Field Manager Pro &mdash; <a href="${APP_URL}" style="color:#7c3aed;text-decoration:none;">${APP_URL}</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const recipients = await query<{ email: string; full_name: string; role: string }>(
    `SELECT email, full_name, role FROM users
     WHERE role IN ('sales_director','owner','developer') AND is_active = TRUE AND email IS NOT NULL AND email != ''`
  )

  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: 'No recipients found' })
  }

  const html = buildCadenceEmailHtml()
  const sent: string[] = []

  for (const r of recipients) {
    await sendEmail(
      r.email,
      'FMP Automated Email Cadence — Full Breakdown',
      html
    )
    sent.push(`${r.full_name} (${r.role}) <${r.email}>`)
  }

  return NextResponse.json({ ok: true, sent: sent.length, recipients: sent })
}
