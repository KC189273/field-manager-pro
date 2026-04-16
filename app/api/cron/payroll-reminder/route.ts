import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
const CST = 'America/Chicago'

function getLastClosedWeek(): { start: string; end: string } {
  const now = new Date()
  const cstDate = new Date(now.toLocaleString('en-US', { timeZone: CST }))
  const dayOfWeek = cstDate.getDay()
  const lastSunday = new Date(cstDate)
  lastSunday.setDate(cstDate.getDate() - dayOfWeek)
  const lastMonday = new Date(lastSunday)
  lastMonday.setDate(lastSunday.getDate() - 6)
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  return { start: fmt(lastMonday), end: fmt(lastSunday) }
}

function fmtPeriod(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const e = new Date(end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${s} – ${e}`
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { start, end } = getLastClosedWeek()
  const periodLabel = fmtPeriod(start, end)

  // Ensure periods exist for all orgs and get DMs who haven't approved
  const dms = await query<{
    id: string
    full_name: string
    email: string
    org_id: string
    org_period_id: string | null
  }>(`
    WITH org_periods AS (
      INSERT INTO payroll_periods (org_id, period_start, period_end)
      SELECT DISTINCT u.org_id, $1::date, $2::date
      FROM users u
      WHERE u.role = 'manager' AND u.is_active = TRUE AND u.org_id IS NOT NULL
      ON CONFLICT (org_id, period_start) DO NOTHING
      RETURNING id, org_id
    ),
    all_periods AS (
      SELECT id, org_id FROM org_periods
      UNION
      SELECT id, org_id FROM payroll_periods WHERE period_start = $1::date
    )
    SELECT
      u.id, u.full_name, u.email, u.org_id,
      ap.id AS org_period_id
    FROM users u
    JOIN all_periods ap ON ap.org_id = u.org_id
    WHERE u.role = 'manager'
      AND u.is_active = TRUE
      AND u.email IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM payroll_dm_approvals pda
        WHERE pda.period_id = ap.id AND pda.dm_id = u.id
      )
  `, [start, end])

  let sent = 0
  for (const dm of dms) {
    await sendEmail(
      dm.email,
      `Action Required: Approve Payroll for ${periodLabel}`,
      `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
          <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
          <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Payroll Approval Required</p>
        </div>
        <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
          <p style="font-size:15px;color:#1c1c1e;margin:0 0 12px;">Hi <strong>${dm.full_name}</strong>,</p>
          <p style="font-size:14px;color:#555;margin:0 0 16px;">The pay period <strong>${periodLabel}</strong> has closed. Please review your team's hours and approve payroll in Field Manager Pro.</p>
          <a href="${APP_URL}/payroll" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">Review & Approve Payroll</a>
          <p style="font-size:12px;color:#8e8e93;margin:20px 0 0;">Please complete your approval today so payroll can be finalized.</p>
        </div>
      </div>
      `
    )
    sent++
  }

  return NextResponse.json({ ok: true, sent, period: periodLabel })
}
