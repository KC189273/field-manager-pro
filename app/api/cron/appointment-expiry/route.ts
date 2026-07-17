import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'

// Runs hourly — expires pending appointments older than 24 hours
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const expired = await query<{ id: string; customer_user_id: string }>(`
      UPDATE appointments a SET status = 'expired', expired_at = NOW(), updated_at = NOW()
      FROM customer_profiles cp
      WHERE a.customer_id = cp.id
        AND a.status = 'pending'
        AND a.created_at < NOW() - INTERVAL '24 hours'
      RETURNING a.id, cp.user_id as customer_user_id
    `)

    for (const appt of expired) {
      sendPushToUser(
        appt.customer_user_id,
        'Booking Not Confirmed',
        'We apologize but your booking was not confirmed. Please try to find another time.',
        'calendar_event'
      ).catch(() => {})
    }

    return NextResponse.json({ ok: true, expired: expired.length })
  } catch (err) {
    console.error('Appointment expiry error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
