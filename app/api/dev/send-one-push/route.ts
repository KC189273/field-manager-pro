import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { sendPushToUser } from '@/lib/apns'

export async function POST() {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await sendPushToUser(
    session.id,
    'Clock-In Update',
    'Starting now, you must be near your store to clock in. Make sure GPS/Location is set to "Always" in your phone settings. Reach out to your DM with any questions.',
    'clock'
  )

  return NextResponse.json({ ok: true, sent: 'developer' })
}
