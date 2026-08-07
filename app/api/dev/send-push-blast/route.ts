import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { sendPushToUsers } from '@/lib/apns'

// One-time push blast to all active employees about geofencing GPS requirement
export async function POST() {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const employees = await query<{ id: string; full_name: string }>(
    `SELECT id, full_name FROM users WHERE role = 'employee' AND is_active = TRUE`
  )

  if (employees.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: 'No active employees found' })
  }

  const title = 'Clock-In Update'
  const body = 'Starting now, you must be near your store to clock in. Make sure GPS/Location is set to "Always" in your phone settings. Reach out to your DM with any questions.'

  await sendPushToUsers(
    employees.map(e => e.id),
    title,
    body,
    'clock'
  )

  return NextResponse.json({
    ok: true,
    sent: employees.length,
    title,
    body,
  })
}
