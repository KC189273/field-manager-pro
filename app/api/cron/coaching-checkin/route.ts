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
        SELECT id FROM users WHERE role IN ('owner', 'ops_manager', 'developer') AND is_active = TRUE AND (is_hidden = FALSE OR is_hidden IS NULL)
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

  return NextResponse.json({ ok: true, nudged, escalated, checked: dmsNoCoaching.length })
}
