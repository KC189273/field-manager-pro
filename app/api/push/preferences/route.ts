import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const ALL_COLUMNS = [
  'email_enabled', 'push_enabled',
  'task_assigned', 'task_completed', 'checklist_submitted', 'flag_created',
  'expense_submitted', 'schedule_published', 'time_off_request',
  'eod_recap', 'weekly_coaching', 'accountability_docs', 'ops_alerts',
  'morning_digest', 'weekly_report', 'shift_swaps', 'supply_requests',
  'facility_tickets', 'clock_events', 'schedule_changes', 'payroll_alerts',
  'db_health_report', 'payroll_report', 'monthly_expense_report', 'termination_docs',
  'dm_clockout_alerts', 'dm_focus_emails',
]

const DEFAULTS = Object.fromEntries(ALL_COLUMNS.map(c => [c, c === 'dm_focus_emails' ? false : true]))

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const prefs = await queryOne(
    `SELECT ${ALL_COLUMNS.join(', ')} FROM notification_preferences WHERE user_id = $1`,
    [session.id]
  )

  return NextResponse.json({ prefs: prefs ?? DEFAULTS })
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  const updates: string[] = []
  const values: unknown[] = [session.id]
  for (const key of ALL_COLUMNS) {
    if (typeof body[key] === 'boolean') {
      values.push(body[key])
      updates.push(`${key} = $${values.length}`)
    }
  }

  if (!updates.length) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  await query(
    `INSERT INTO notification_preferences (user_id, ${updates.map(u => u.split(' = ')[0]).join(', ')})
     VALUES ($1, ${values.slice(1).map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')}, updated_at = NOW()`,
    values
  )

  return NextResponse.json({ ok: true })
}
