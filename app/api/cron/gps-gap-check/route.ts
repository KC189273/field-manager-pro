import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'

// Runs every 30 minutes.
// 1. DM GPS gaps → alert ops managers (no longer self-alerts to the DM).
// 2. Employee GPS gaps → alert the employee's manager (DM).
// The 30–55 minute window matches the cron interval to avoid duplicate alerts.

export async function GET() {
  // ── DM (manager) GPS gaps → notify ops managers ──
  const staleDms = await query<{
    shift_id: string
    user_id: string
    full_name: string
    org_id: string | null
    gap_minutes: number
  }>(
    `SELECT
       s.id          AS shift_id,
       s.user_id,
       u.full_name,
       u.org_id,
       ROUND(
         EXTRACT(EPOCH FROM (
           NOW() - COALESCE(MAX(b.recorded_at), s.clock_in_at)
         )) / 60
       )::int        AS gap_minutes
     FROM shifts s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN gps_breadcrumbs b ON b.shift_id = s.id AND b.is_gap = FALSE
     WHERE s.clock_in_at IS NOT NULL
       AND s.clock_out_at IS NULL
       AND u.role = 'manager'
     GROUP BY s.id, s.user_id, u.full_name, u.org_id
     HAVING ROUND(
       EXTRACT(EPOCH FROM (
         NOW() - COALESCE(MAX(b.recorded_at), s.clock_in_at)
       )) / 60
     ) BETWEEN 30 AND 55`
  )

  for (const shift of staleDms) {
    if (shift.org_id) {
      const opsManagers = await query<{ id: string }>(
        `SELECT id FROM users
         WHERE org_id = $1 AND role IN ('ops_manager', 'owner', 'sales_director') AND is_active = TRUE`,
        [shift.org_id]
      )
      for (const u of opsManagers) {
        sendPushToUser(
          u.id,
          'Location Alert',
          `${shift.full_name}'s location hasn't updated in ${shift.gap_minutes} min.`
        ).catch(() => {})
      }
    }
  }

  // ── Employee GPS gaps → notify their manager (DM) ──
  const staleEmployees = await query<{
    shift_id: string
    user_id: string
    full_name: string
    manager_id: string | null
    gap_minutes: number
  }>(
    `SELECT
       s.id          AS shift_id,
       s.user_id,
       u.full_name,
       u.manager_id,
       ROUND(
         EXTRACT(EPOCH FROM (
           NOW() - COALESCE(MAX(b.recorded_at), s.clock_in_at)
         )) / 60
       )::int        AS gap_minutes
     FROM shifts s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN gps_breadcrumbs b ON b.shift_id = s.id AND b.is_gap = FALSE
     WHERE s.clock_in_at IS NOT NULL
       AND s.clock_out_at IS NULL
       AND u.role = 'employee'
     GROUP BY s.id, s.user_id, u.full_name, u.manager_id
     HAVING ROUND(
       EXTRACT(EPOCH FROM (
         NOW() - COALESCE(MAX(b.recorded_at), s.clock_in_at)
       )) / 60
     ) BETWEEN 30 AND 55`
  )

  return NextResponse.json({
    ok: true,
    dmAlerts: staleDms.length,
    employeeAlerts: staleEmployees.length,
  })
}
