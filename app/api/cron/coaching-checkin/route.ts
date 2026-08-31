import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'

// Runs daily at 10 AM CST — nudges DMs who haven't submitted coaching in 3+ days
// Also alerts leadership if a DM hasn't coached in 5+ days

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find DMs with no coaching submissions in the last 3 days
  const dmsNoCoaching = await query<{
    id: string; full_name: string; manager_id: string | null
    last_coaching_at: string | null; days_since: number | null
  }>(`
    SELECT u.id, u.full_name, u.manager_id,
      (SELECT MAX(cg.graded_at)::text FROM coaching_grades cg WHERE cg.dm_id = u.id) as last_coaching_at,
      EXTRACT(DAY FROM NOW() - (SELECT MAX(cg.graded_at) FROM coaching_grades cg WHERE cg.dm_id = u.id))::int as days_since
    FROM users u
    WHERE u.role = 'manager' AND u.is_active = TRUE AND (u.is_hidden = FALSE OR u.is_hidden IS NULL)
  `)

  let nudged = 0
  let escalated = 0

  for (const dm of dmsNoCoaching) {
    // Skip if they've coached recently or have never coached (new DMs get grace period)
    if (dm.days_since === null) continue // Never coached — don't nudge until coaching grades feature is established
    if (dm.days_since < 3) continue // Coached recently — all good

    if (dm.days_since >= 3 && dm.days_since < 5) {
      // Gentle nudge to the DM
      sendPushToUser(
        dm.id,
        'Coaching Reminder',
        `It's been ${dm.days_since} days since your last coaching submission. Get into a store and coach someone today!`,
        'task_assigned'
      ).catch(() => {})
      nudged++
    }

    if (dm.days_since >= 5) {
      // Nudge the DM
      sendPushToUser(
        dm.id,
        'Coaching Overdue',
        `It's been ${dm.days_since} days since your last coaching submission. Coaching your reps is a core part of the DM role — submit one today.`,
        'task_assigned'
      ).catch(() => {})
      nudged++

      // Alert leadership
      const leaders = await query<{ id: string }>(`
        SELECT id FROM users WHERE role IN ('owner', 'ops_field_leader', 'ops_manager', 'developer') AND is_active = TRUE AND (is_hidden = FALSE OR is_hidden IS NULL)
      `)
      for (const leader of leaders) {
        sendPushToUser(
          leader.id,
          'DM Coaching Gap',
          `${dm.full_name} hasn't submitted coaching in ${dm.days_since} days.`,
          'flag_created'
        ).catch(() => {})
      }
      escalated++
    }
  }

  // ── Same-day visit-without-coaching check ──
  // If a DM submitted store visits today but zero coaching, nudge them
  let sameDayNudged = 0
  const todayVisitors = await query<{
    dm_id: string; dm_name: string; total_visits: number; with_coaching: number; stores_without: string
  }>(`
    SELECT u.id as dm_id, u.full_name as dm_name,
      COUNT(*)::int as total_visits,
      COUNT(*) FILTER (WHERE v.visit_type IN ('quick_coaching', 'remote_coaching'))::int as with_coaching,
      STRING_AGG(CASE WHEN v.visit_type NOT IN ('quick_coaching', 'remote_coaching') THEN SPLIT_PART(v.store_address, ',', 1) END, ', ') as stores_without
    FROM dm_store_visits v
    JOIN users u ON u.id = v.submitted_by_id
    WHERE (v.submitted_at AT TIME ZONE 'America/Chicago')::date = CURRENT_DATE
      AND u.role = 'manager' AND u.is_active = TRUE
    GROUP BY u.id, u.full_name
    HAVING COUNT(*) FILTER (WHERE v.visit_type NOT IN ('quick_coaching', 'remote_coaching')) > 0
  `)

  for (const dm of todayVisitors) {
    if (dm.with_coaching === 0) {
      // Visited but did zero coaching — strong nudge
      sendPushToUser(
        dm.dm_id,
        'Coaching Required',
        `You visited ${dm.total_visits} store${dm.total_visits > 1 ? 's' : ''} today without submitting coaching. Every visit should include a coaching session.`,
        'task_assigned'
      ).catch(() => {})
      sameDayNudged++
    } else if (dm.with_coaching < dm.total_visits) {
      // Some coaching but not all — gentle reminder
      sendPushToUser(
        dm.dm_id,
        'Coaching Reminder',
        `You coached at ${dm.with_coaching} of ${dm.total_visits} visits today. Submit coaching for all store visits: ${dm.stores_without}`,
        'task_assigned'
      ).catch(() => {})
      sameDayNudged++
    }
  }

  return NextResponse.json({ ok: true, nudged, escalated, sameDayNudged, checked: dmsNoCoaching.length })
}
