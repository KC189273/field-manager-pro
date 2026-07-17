import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { queryOne } from '@/lib/db'
import { sendDmEodRecap } from '@/lib/dm-eod-recap'

export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Find a recent DM shift with activity
  const shift = await queryOne<{
    id: string; user_id: string; full_name: string; email: string; org_id: string
    clock_in_at: string
  }>(`
    SELECT s.id, s.user_id, u.full_name, u.email, u.org_id, s.clock_in_at
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    WHERE u.role = 'manager' AND s.clock_out_at IS NOT NULL AND u.org_id IS NOT NULL
    ORDER BY s.clock_out_at DESC
    LIMIT 1
  `)

  if (!shift) return NextResponse.json({ error: 'No DM shifts found' }, { status: 404 })

  const clockIn = new Date(shift.clock_in_at)

  // Mock visits to show full flow in example
  const mockVisits = [
    {
      store_address: '4521 W Main St, Springfield, IL',
      visit_type: 'quick',
      submitted_at: new Date(clockIn.getTime() + 3600000).toISOString(),
      intentionality: 'Observe morning rush sales process and check display compliance',
      quick_interaction_notes: 'Watched 3 customer interactions. Marcus greeted quickly but missed HSI on 2 of 3.',
      quick_takeaways: 'Team is greeting well but missing HSI offers on 3 of 4 transactions observed. A-frame needs updating with current promo.',
      quick_impact: 'Coached Marcus on HSI pitch — he committed to offering on every interaction. Updated A-frame with correct promo materials.',
      assigned_rdm: 'Kalee Heinzman',
    },
    {
      store_address: '1200 S 6th St, Springfield, IL',
      visit_type: 'quick_coaching',
      submitted_at: new Date(clockIn.getTime() + 10800000).toISOString(),
      intentionality: 'Follow up on last week performance conversation with Taylor',
      quick_interaction_notes: 'Observed Taylor handle 2 customers. MIM pitch improved significantly since last visit.',
      quick_takeaways: 'Taylor showed significant improvement on MIM offers. Still struggling with objection handling on price. Needs more role play practice.',
      quick_impact: 'Role played 3 pricing objection scenarios. Taylor gained confidence and committed to 5 MIM offers per shift.',
      assigned_rdm: 'Kalee Heinzman',
    },
  ]

  const mockCoaching = [
    {
      employee_name: 'Taylor Brooks',
      store_address: '1200 S 6th St, Springfield, IL',
      obs_primary_issue: 'Skill',
      rp_score: 'Needs Work',
      submitted_at: new Date(clockIn.getTime() + 10800000).toISOString(),
    },
  ]

  const mockTasks = [
    { title: 'Update A-frame with June promo', assignee_name: 'Marcus Rivera', store_address: '4521 W Main St', completed: false, created_or_completed: new Date(clockIn.getTime() + 5400000).toISOString() },
    { title: 'Complete HSI training module', assignee_name: 'Taylor Brooks', store_address: null, completed: false, created_or_completed: new Date(clockIn.getTime() + 12600000).toISOString() },
  ]

  await sendDmEodRecap({
    dmId: shift.user_id,
    dmName: shift.full_name,
    dmEmail: shift.email,
    orgId: shift.org_id,
    shiftId: shift.id,
    mockVisits,
    mockCoaching,
    mockTasks,
  })

  return NextResponse.json({
    ok: true,
    dm: shift.full_name,
    shiftId: shift.id,
    message: 'Example EOD recap with Excel attachment sent to your email.',
  })
}
