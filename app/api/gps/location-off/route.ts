import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'manager') return NextResponse.json({ ok: true })

  // Notify the DM themselves
  sendPushToUser(
    session.id,
    'Location Access Required',
    'Field Manager Pro needs location access to track your store visits. Please re-enable Location Services.'
  ).catch(() => {})

  // Notify ops managers in the same org
  if (session.org_id) {
    const opsManagers = await query<{ id: string }>(
      `SELECT id FROM users
       WHERE org_id = $1 AND role IN ('ops_manager', 'owner', 'sales_director') AND is_active = TRUE`,
      [session.org_id]
    )
    for (const u of opsManagers) {
      sendPushToUser(
        u.id,
        'Location Alert',
        `${session.fullName} has disabled location tracking.`
      ).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true })
}
