import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'

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

// Returns today's date as YYYY-MM-DD in CST
function todayCst(): string {
  const now = new Date()
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }))
    .toISOString()
    .split('T')[0]
}

// Returns the Monday of the week containing the given CST date string
function mondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const closed = getLastClosedPeriod()
  if (!closed) {
    return NextResponse.json({ ok: true, sent: 0, period: null, message: 'No closed period yet' })
  }

  const { start, end } = closed
  const periodLabel = fmtPeriod(start, end)
  const today = todayCst()
  const weekStart = mondayOfWeek(today)
  const dueDate = `${today}T12:00:00-05:00` // noon CST today

  // Ensure payroll_periods exist for all orgs and find DMs who haven't submitted
  const dms = await query<{
    id: string
    full_name: string
    email: string
    org_id: string
    period_id: string
  }>(`
    WITH org_periods AS (
      INSERT INTO payroll_periods (org_id, period_start, period_end, status)
      SELECT DISTINCT u.org_id, $1::date, $2::date, 'pending_dm'
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
      u.id,
      u.full_name,
      u.email,
      u.org_id,
      ap.id AS period_id
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
    // Send reminder email
    sendEmail(
      dm.email,
      `Action Required: Submit timecards for ${periodLabel}`,
      `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
          <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
          <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">Payroll Submission Required</p>
        </div>
        <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
          <p style="font-size:15px;color:#1c1c1e;margin:0 0 12px;">Hi <strong>${dm.full_name}</strong>,</p>
          <p style="font-size:14px;color:#555;margin:0 0 16px;">The pay period <strong>${periodLabel}</strong> has closed. Please review your team's hours and lock &amp; submit timecards in Field Manager Pro.</p>
          <div style="background:#fff3e0;border-radius:10px;padding:14px 18px;margin-bottom:20px;">
            <p style="font-size:13px;font-weight:600;color:#e65100;margin:0 0 4px;">Deadline: Today at noon CST</p>
            <p style="font-size:13px;color:#555;margin:0;">Once the deadline passes, payroll may be finalized without your submission.</p>
          </div>
          <a href="${APP_URL}/payroll" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">Review &amp; Submit Timecards</a>
        </div>
      </div>
      `
    ).catch(() => {})
    sent++

    // Create task if one doesn't already exist for this period's submission week
    const existingTask = await query(`
      SELECT 1 FROM tasks
      WHERE assignee_id = $1
        AND title LIKE '%Verify and submit timecards%'
        AND due_date >= $2::timestamptz
        AND due_date < ($2::timestamptz + INTERVAL '7 days')
      LIMIT 1
    `, [dm.id, `${weekStart}T00:00:00-05:00`])

    if (existingTask.length === 0) {
      await query(`
        INSERT INTO tasks (org_id, week_start, title, description, assignee_id, due_date, created_by, created_at)
        VALUES ($1, $2::date, $3, $4, $5, $6::timestamptz, $5, NOW())
      `, [
        dm.org_id,
        weekStart,
        'Verify and submit timecards',
        `Pay period: ${periodLabel}. Deadline: Today at noon CST.`,
        dm.id,
        dueDate,
      ])
    }
  }

  return NextResponse.json({ ok: true, sent, period: periodLabel })
}
