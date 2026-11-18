import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser, sendPushToUsers } from '@/lib/apns'

const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
const ANCHOR = new Date('2026-03-30T12:00:00.000Z')

function getCurrentPeriod(): { start: string; end: string; id_key: string } | null {
  const cstDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const daysSince = Math.floor((new Date(cstDate + 'T12:00:00Z').getTime() - ANCHOR.getTime()) / 86400000)
  const idx = Math.floor(daysSince / 14)
  const start = new Date(ANCHOR)
  start.setUTCDate(start.getUTCDate() + idx * 14)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 13)
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
    id_key: start.toISOString().split('T')[0],
  }
}

function fmtPeriod(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const e = new Date(end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${s} – ${e}`
}

// Runs every Sunday at 8 PM CST
// Auto-locks all DM timecards for the current week by creating payroll_dm_approvals records
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Guard: only run at 8 PM CST or later on Sundays
  const cstHour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }))
  const cstDay = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short' })
  if (cstDay !== 'Sun' || cstHour < 20) {
    return NextResponse.json({ ok: true, skipped: true, reason: `Not Sunday 8 PM CST (${cstDay} ${cstHour}:00)` })
  }

  const period = getCurrentPeriod()
  if (!period) return NextResponse.json({ ok: true, skipped: true, reason: 'No current period' })

  const periodLabel = fmtPeriod(period.start, period.end)

  // Find all orgs with payroll active
  const orgs = await query<{ id: string; name: string }>(`
    SELECT id, name FROM organizations
    WHERE payroll_launch_date IS NOT NULL AND payroll_launch_date <= CURRENT_DATE
  `)

  let totalLocked = 0

  for (const org of orgs) {
    // Ensure the period exists
    await queryOne(`
      INSERT INTO payroll_periods (org_id, period_start, period_end, status)
      VALUES ($1, $2, $3, 'pending_dm')
      ON CONFLICT (org_id, period_start) DO NOTHING
    `, [org.id, period.start, period.end])

    const dbPeriod = await queryOne<{ id: string }>(`
      SELECT id FROM payroll_periods WHERE org_id = $1 AND period_start = $2
    `, [org.id, period.start])
    if (!dbPeriod) continue

    // Find all active DMs with employees who haven't been locked yet
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
    `, [org.id, dbPeriod.id])

    for (const dm of dms) {
      // Auto-lock by creating the approval record
      await queryOne(`
        INSERT INTO payroll_dm_approvals (period_id, dm_id)
        VALUES ($1, $2)
        ON CONFLICT (period_id, dm_id) DO NOTHING
      `, [dbPeriod.id, dm.id])

      // Notify DM
      sendPushToUser(
        dm.id,
        'Timecards Locked',
        `Your team's timecards for ${periodLabel} have been automatically locked. Contact ops if you need edits.`,
        'payroll'
      ).catch(() => {})

      totalLocked++
    }

    // Notify ops managers and owners
    if (dms.length > 0) {
      const leaders = await query<{ id: string }>(`
        SELECT id FROM users WHERE org_id = $1 AND is_active = TRUE AND role IN ('ops_manager', 'owner', 'developer')
      `, [org.id])
      if (leaders.length) {
        sendPushToUsers(
          leaders.map(l => l.id),
          'Timecards Auto-Locked',
          `${dms.length} DM timecard${dms.length !== 1 ? 's' : ''} have been auto-locked for ${periodLabel}. Review and submit payroll.`,
          'payroll'
        ).catch(() => {})
      }
    }
  }

  return NextResponse.json({ ok: true, totalLocked, period: periodLabel })
}
