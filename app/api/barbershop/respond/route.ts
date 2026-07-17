import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'
import { sendEmail } from '@/lib/notifications'

// GET — fetch appointment data for the respond page (no auth — accessed via email link)
export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const appt = await queryOne<{
    id: string; barber_id: string; appointment_date: string; start_time: string
    total_price: string; status: string; decline_reason: string | null
    proposed_alt_date: string | null; proposed_alt_time: string | null
    org_id: string; service_ids: string
  }>(`
    SELECT id, barber_id, appointment_date::text, start_time::text,
           total_price::text, status, decline_reason,
           proposed_alt_date::text, proposed_alt_time::text,
           org_id, array_to_string(service_ids, ',') as service_ids
    FROM appointments WHERE id = $1
  `, [id])

  if (!appt) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!appt.proposed_alt_date || !appt.proposed_alt_time) {
    return NextResponse.json({ error: 'No proposal to respond to' }, { status: 400 })
  }

  const bp = await queryOne<{ display_name: string }>(`SELECT display_name FROM barber_profiles WHERE id = $1`, [appt.barber_id])
  const shop = await queryOne<{ shop_name: string; address: string | null }>(`SELECT shop_name, address FROM shop_settings WHERE org_id = $1`, [appt.org_id])

  // Get service names
  let serviceNames = ''
  if (appt.service_ids) {
    const ids = appt.service_ids.split(',').filter(Boolean)
    if (ids.length > 0) {
      const svcs = await query<{ name: string }>(`SELECT name FROM barber_services WHERE id = ANY($1)`, [ids])
      serviceNames = svcs.map(s => s.name).join(', ')
    }
  }

  return NextResponse.json({
    appointment: {
      id: appt.id,
      barber_id: appt.barber_id,
      barber_name: bp?.display_name ?? 'Your barber',
      original_date: appt.appointment_date,
      original_time: appt.start_time,
      proposed_date: appt.proposed_alt_date,
      proposed_time: appt.proposed_alt_time,
      service_names: serviceNames,
      total_price: appt.total_price,
      shop_name: shop?.shop_name ?? '',
      shop_address: shop?.address ?? null,
      status: appt.status,
      decline_reason: appt.decline_reason,
    },
  })
}

// POST — accept the proposed reschedule or pick a different time
export async function POST(req: NextRequest) {
  const { id, action, date, time } = await req.json()
  if (!id || !['accept', 'pick_time'].includes(action)) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

  const appt = await queryOne<{
    id: string; barber_id: string; customer_id: string
    proposed_alt_date: string; proposed_alt_time: string
    total_price: string; org_id: string; status: string
  }>(`
    SELECT id, barber_id, customer_id, proposed_alt_date::text, proposed_alt_time::text,
           total_price::text, org_id, status
    FROM appointments WHERE id = $1
  `, [id])

  if (!appt) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!appt.proposed_alt_date || !appt.proposed_alt_time) {
    return NextResponse.json({ error: 'No proposal' }, { status: 400 })
  }
  if (appt.status !== 'declined') {
    return NextResponse.json({ error: 'This appointment has already been updated' }, { status: 400 })
  }

  const bp = await queryOne<{ user_id: string; display_name: string; default_duration: number }>(`
    SELECT user_id, display_name, default_duration FROM barber_profiles WHERE id = $1
  `, [appt.barber_id])
  if (!bp) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })

  const customer = await queryOne<{ full_name: string }>(`
    SELECT u.full_name FROM customer_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.id = $1
  `, [appt.customer_id])

  if (action === 'accept') {
    const [sh, sm] = appt.proposed_alt_time.split(':').map(Number)
    const endMins = sh * 60 + sm + bp.default_duration
    const endTime = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`

    await query(`
      UPDATE appointments SET
        appointment_date = $2, start_time = $3, end_time = $4,
        status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [id, appt.proposed_alt_date, appt.proposed_alt_time, endTime])

    const dateLabel = new Date(appt.proposed_alt_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const timeLabel = new Date(`2000-01-01T${appt.proposed_alt_time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

    sendPushToUser(bp.user_id, 'Reschedule Accepted!',
      `${customer?.full_name ?? 'Your customer'} accepted the new time: ${dateLabel} at ${timeLabel}`,
      'calendar_event'
    ).catch(() => {})

    const barberEmail = await queryOne<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [bp.user_id])
    if (barberEmail?.email) {
      const html = `<div style="font-family:-apple-system,sans-serif;max-width:500px;margin:0 auto">
        <div style="background:#000;padding:20px 24px;border-radius:12px 12px 0 0">
          <h1 style="color:#22C55E;margin:0;font-size:20px">Reschedule Accepted</h1>
        </div>
        <div style="background:#111;border:1px solid #333;border-top:none;border-radius:0 0 12px 12px;padding:24px;color:white">
          <p style="margin:0 0 16px;font-size:14px">${customer?.full_name ?? 'Your customer'} accepted your proposed reschedule.</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#888;font-size:13px">Customer</td><td style="padding:6px 0;color:white;font-size:13px;font-weight:600">${customer?.full_name ?? 'Customer'}</td></tr>
            <tr><td style="padding:6px 0;color:#888;font-size:13px">Date</td><td style="padding:6px 0;color:white;font-size:13px">${dateLabel}</td></tr>
            <tr><td style="padding:6px 0;color:#888;font-size:13px">Time</td><td style="padding:6px 0;color:white;font-size:13px">${timeLabel}</td></tr>
          </table>
        </div>
      </div>`
      sendEmail(barberEmail.email, `Reschedule Accepted — ${customer?.full_name ?? 'Customer'} on ${dateLabel}`, html).catch(() => {})
    }

  } else if (action === 'pick_time') {
    // Customer picked a different time — update the SAME appointment, set to pending
    if (!date || !time) return NextResponse.json({ error: 'date and time required' }, { status: 400 })

    const [sh, sm] = time.split(':').map(Number)
    const endMins = sh * 60 + sm + bp.default_duration
    const endTime = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`

    // Check for conflicts at the new time
    const conflict = await queryOne(`
      SELECT 1 FROM appointments
      WHERE barber_id = $1 AND appointment_date = $2 AND status IN ('pending', 'confirmed')
        AND start_time < $4 AND end_time > $3 AND id != $5
    `, [appt.barber_id, date, time, endTime, id])
    if (conflict) return NextResponse.json({ error: 'This time slot is no longer available' }, { status: 409 })

    await query(`
      UPDATE appointments SET
        appointment_date = $2, start_time = $3, end_time = $4,
        status = 'pending', confirmed_at = NULL, proposed_alt_date = NULL, proposed_alt_time = NULL,
        decline_reason = NULL, reminder_sent_at = NULL, updated_at = NOW()
      WHERE id = $1
    `, [id, date, time, endTime])

    const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const timeLabel = new Date(`2000-01-01T${time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

    sendPushToUser(bp.user_id, 'New Time Requested',
      `${customer?.full_name ?? 'Your customer'} picked a different time: ${dateLabel} at ${timeLabel}`,
      'calendar_event'
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
