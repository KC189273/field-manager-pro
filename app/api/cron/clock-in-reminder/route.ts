import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendPushToUsers, sendPushToUser } from '@/lib/apns'

let ensured = false
async function ensureTables() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS shift_reminders_sent (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scheduled_shift_id UUID NOT NULL,
      sent_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (scheduled_shift_id)
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS shift_clockout_reminders_sent (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scheduled_shift_id UUID NOT NULL,
      sent_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (scheduled_shift_id)
    )
  `)
}

export async function GET() {
  try { await ensureTables() } catch { /* already exists */ }

  const nowCst = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })
  const cst = new Date(nowCst)
  const hour = cst.getHours()
  const minute = cst.getMinutes()

  const results = { dm: 0, clockIn: 0, clockOut: 0 }

  // ── 1. DM and above: once at 9:00 AM CST ──
  if (hour === 9 && minute === 0) {
    const notClockedIn = await query<{ id: string }>(`
      SELECT u.id
      FROM users u
      WHERE u.role IN ('manager', 'ops_manager', 'owner', 'sales_director')
        AND u.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM shifts s
          WHERE s.user_id = u.id
            AND (s.clock_in_at AT TIME ZONE 'America/Chicago')::date = (NOW() AT TIME ZONE 'America/Chicago')::date
        )
    `)

    if (notClockedIn.length > 0) {
      await sendPushToUsers(
        notClockedIn.map(u => u.id),
        'Clock In Reminder',
        "Good morning! Don't forget to clock in today.",
        'clock_in_reminder'
      ).catch(() => {})
      results.dm = notClockedIn.length

    }
  }

  // ── 2. Employees: 2 minutes before published shift start ──
  const upcomingShifts = await query<{
    id: string
    employee_id: string
    start_time: string
    store_address: string
  }>(`
    SELECT ss.id, ss.employee_id, ss.start_time::text, dsl.address AS store_address
    FROM scheduled_shifts ss
    JOIN users u ON u.id = ss.employee_id
    JOIN dm_store_locations dsl ON dsl.id = ss.store_location_id
    INNER JOIN scheduled_shifts_publish ssp
      ON ssp.store_location_id = ss.store_location_id
      AND ssp.week_start = date_trunc('week', ss.shift_date)::date
    WHERE u.is_active = TRUE
      AND u.role = 'employee'
      AND ss.shift_date = (NOW() AT TIME ZONE 'America/Chicago')::date
      AND (ss.shift_date + ss.start_time)::timestamp AT TIME ZONE 'America/Chicago'
            BETWEEN NOW() + INTERVAL '1 minute 30 seconds'
                AND NOW() + INTERVAL '2 minutes 30 seconds'
      AND NOT EXISTS (
        SELECT 1 FROM shift_reminders_sent srs WHERE srs.scheduled_shift_id = ss.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM shifts s
        WHERE s.user_id = ss.employee_id
          AND (s.clock_in_at AT TIME ZONE 'America/Chicago')::date = (NOW() AT TIME ZONE 'America/Chicago')::date
          AND s.clock_out_at IS NULL
      )
  `)

  for (const shift of upcomingShifts) {
    // Record before sending to prevent double-send on retry
    try {
      await query(`INSERT INTO shift_reminders_sent (scheduled_shift_id) VALUES ($1)`, [shift.id])
    } catch { continue } // unique constraint — already sent

    const [h, m] = shift.start_time.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    const timeStr = `${h12}:${String(m).padStart(2, '0')} ${ampm}`
    const shortAddr = shift.store_address.split(',')[0]

    await sendPushToUser(
      shift.employee_id,
      'Clock In Reminder',
      `Your shift at ${shortAddr} starts at ${timeStr}. Time to clock in!`,
      'clock_in_reminder'
    ).catch(() => {})

    results.clockIn++
  }

  // ── 3. DM and above: clock-out reminder at 8:00 PM CST ──
  if (hour === 20 && minute === 0) {
    const stillClockedIn = await query<{ id: string }>(`
      SELECT u.id
      FROM users u
      WHERE u.role IN ('manager', 'ops_manager', 'owner', 'sales_director')
        AND u.is_active = TRUE
        AND EXISTS (
          SELECT 1 FROM shifts s
          WHERE s.user_id = u.id
            AND (s.clock_in_at AT TIME ZONE 'America/Chicago')::date = (NOW() AT TIME ZONE 'America/Chicago')::date
            AND s.clock_out_at IS NULL
        )
    `)

    if (stillClockedIn.length > 0) {
      await sendPushToUsers(
        stillClockedIn.map(u => u.id),
        'Clock Out Reminder',
        "Heads up — you're still clocked in. Don't forget to clock out!",
        'clock_out_reminder'
      ).catch(() => {})
      results.dm += stillClockedIn.length
    }
  }

  // ── 4. Employees: clock-out reminder 5 minutes after shift end ──
  const overdueShifts = await query<{
    id: string
    employee_id: string
    end_time: string
    store_address: string
  }>(`
    SELECT ss.id, ss.employee_id, ss.end_time::text, dsl.address AS store_address
    FROM scheduled_shifts ss
    JOIN users u ON u.id = ss.employee_id
    JOIN dm_store_locations dsl ON dsl.id = ss.store_location_id
    INNER JOIN scheduled_shifts_publish ssp
      ON ssp.store_location_id = ss.store_location_id
      AND ssp.week_start = date_trunc('week', ss.shift_date)::date
    WHERE u.is_active = TRUE
      AND u.role = 'employee'
      AND ss.shift_date = (NOW() AT TIME ZONE 'America/Chicago')::date
      AND (ss.shift_date + ss.end_time)::timestamp AT TIME ZONE 'America/Chicago'
            BETWEEN NOW() - INTERVAL '5 minutes 30 seconds'
                AND NOW() - INTERVAL '4 minutes 30 seconds'
      AND NOT EXISTS (
        SELECT 1 FROM shift_clockout_reminders_sent scrs WHERE scrs.scheduled_shift_id = ss.id
      )
      AND EXISTS (
        SELECT 1 FROM shifts s
        WHERE s.user_id = ss.employee_id
          AND (s.clock_in_at AT TIME ZONE 'America/Chicago')::date = (NOW() AT TIME ZONE 'America/Chicago')::date
          AND s.clock_out_at IS NULL
      )
  `)

  for (const shift of overdueShifts) {
    try {
      await query(`INSERT INTO shift_clockout_reminders_sent (scheduled_shift_id) VALUES ($1)`, [shift.id])
    } catch { continue } // unique constraint — already sent

    const [h, m] = shift.end_time.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    const timeStr = `${h12}:${String(m).padStart(2, '0')} ${ampm}`
    const shortAddr = shift.store_address.split(',')[0]

    await sendPushToUser(
      shift.employee_id,
      'Clock Out Reminder',
      `Your shift at ${shortAddr} ended at ${timeStr}. Don't forget to clock out!`,
      'clock_out_reminder'
    ).catch(() => {})

    results.clockOut++
  }

  // ── Cleanup: purge stale reminder records older than 7 days ──
  // Runs every invocation (cheap, indexed by sent_at)
  await query(`DELETE FROM shift_reminders_sent WHERE sent_at < NOW() - INTERVAL '7 days'`).catch(() => {})
  await query(`DELETE FROM shift_clockout_reminders_sent WHERE sent_at < NOW() - INTERVAL '7 days'`).catch(() => {})
  await query(`DELETE FROM login_attempts WHERE window_start < NOW() - INTERVAL '1 hour'`).catch(() => {})
  await query(`DELETE FROM overstaffing_alerts WHERE alerted_at < NOW() - INTERVAL '30 days'`).catch(() => {})

  return NextResponse.json({ ok: true, ...results })
}
