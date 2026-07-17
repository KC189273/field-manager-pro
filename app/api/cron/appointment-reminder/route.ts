import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'
import { sendEmail } from '@/lib/notifications'

// Runs every 15 min — sends 1-hour reminder push + email for confirmed appointments
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const upcoming = await query<{
      id: string; customer_user_id: string; customer_email: string; customer_name: string
      barber_name: string; start_time: string; appointment_date: string
      total_price: string; org_id: string
    }>(`
      SELECT a.id, cp.user_id as customer_user_id, u.email as customer_email, u.full_name as customer_name,
             bp.display_name as barber_name, a.start_time::text, a.appointment_date::text,
             a.total_price::text, a.org_id
      FROM appointments a
      JOIN customer_profiles cp ON cp.id = a.customer_id
      JOIN users u ON u.id = cp.user_id
      JOIN barber_profiles bp ON bp.id = a.barber_id
      WHERE a.status = 'confirmed'
        AND a.appointment_date = CURRENT_DATE
        AND a.reminder_sent_at IS NULL
        AND (a.appointment_date + a.start_time) BETWEEN NOW() + INTERVAL '45 minutes' AND NOW() + INTERVAL '75 minutes'
    `)

    for (const appt of upcoming) {
      const timeLabel = new Date(`2000-01-01T${appt.start_time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      const dateLabel = new Date(appt.appointment_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

      // Push notification
      sendPushToUser(
        appt.customer_user_id,
        'Appointment Reminder',
        `Your appointment with ${appt.barber_name} is in about 1 hour at ${timeLabel}`,
        'calendar_event'
      ).catch(() => {})

      // Email reminder
      const shop = await queryOne<{ shop_name: string; address: string | null }>(`
        SELECT shop_name, address FROM shop_settings WHERE org_id = $1
      `, [appt.org_id])

      const html = `<div style="font-family:-apple-system,sans-serif;max-width:500px;margin:0 auto">
        <div style="background:#000;padding:20px 24px;border-radius:12px 12px 0 0">
          <h1 style="color:#3B82F6;margin:0;font-size:20px">Appointment Reminder</h1>
        </div>
        <div style="background:#111;border:1px solid #333;border-top:none;border-radius:0 0 12px 12px;padding:24px;color:white">
          <p style="margin:0 0 4px;font-size:16px;font-weight:600">Hey ${appt.customer_name.split(' ')[0]}!</p>
          <p style="margin:0 0 16px;font-size:14px;color:#aaa">Your appointment is coming up in about 1 hour.</p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
            <tr><td style="padding:6px 0;color:#888;font-size:13px">Barber</td><td style="padding:6px 0;color:white;font-size:13px;font-weight:600">${appt.barber_name}</td></tr>
            <tr><td style="padding:6px 0;color:#888;font-size:13px">Date</td><td style="padding:6px 0;color:white;font-size:13px">${dateLabel}</td></tr>
            <tr><td style="padding:6px 0;color:#888;font-size:13px">Time</td><td style="padding:6px 0;color:white;font-size:13px">${timeLabel}</td></tr>
            ${Number(appt.total_price) > 0 ? `<tr><td style="padding:6px 0;color:#888;font-size:13px">Price</td><td style="padding:6px 0;color:#3B82F6;font-size:13px;font-weight:600">$${appt.total_price}</td></tr>` : ''}
            ${shop?.address ? `<tr><td style="padding:6px 0;color:#888;font-size:13px">Location</td><td style="padding:6px 0;color:white;font-size:13px">${shop.address}</td></tr>` : ''}
          </table>
          <p style="font-size:12px;color:#555;margin:16px 0 0">See you soon! — ${shop?.shop_name ?? 'Your barbershop'}</p>
        </div>
      </div>`

      sendEmail(appt.customer_email, `Reminder: Appointment with ${appt.barber_name} at ${timeLabel}`, html).catch(err => {
        console.error('Reminder email failed:', err)
      })

      await query(`UPDATE appointments SET reminder_sent_at = NOW() WHERE id = $1`, [appt.id])
    }

    return NextResponse.json({ ok: true, reminded: upcoming.length })
  } catch (err) {
    console.error('Appointment reminder error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
