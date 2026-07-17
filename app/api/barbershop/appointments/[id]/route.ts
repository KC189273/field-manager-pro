import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'
import { sendEmail } from '@/lib/notifications'

// PATCH — approve, decline, cancel, complete an appointment
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { action, decline_reason, proposed_alt_date, proposed_alt_time, barber_note } = await req.json()

  const appt = await queryOne<{
    id: string; barber_id: string; customer_id: string; status: string
    appointment_date: string; start_time: string; total_price: string; org_id: string
  }>(`SELECT id, barber_id, customer_id, status, appointment_date::text, start_time::text, total_price::text, org_id FROM appointments WHERE id = $1`, [id])

  if (!appt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const bp = await queryOne<{ user_id: string; display_name: string; venmo_username: string | null; cashapp_tag: string | null }>(`
    SELECT user_id, display_name, venmo_username, cashapp_tag FROM barber_profiles WHERE id = $1
  `, [appt.barber_id])
  const customer = await queryOne<{ user_id: string; full_name: string; email: string }>(`
    SELECT cp.user_id, u.full_name, u.email FROM customer_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.id = $1
  `, [appt.customer_id])

  if (!bp || !customer) return NextResponse.json({ error: 'Data not found' }, { status: 404 })

  const dateLabel = new Date(appt.appointment_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const timeLabel = new Date(`2000-01-01T${appt.start_time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  if (action === 'confirm') {
    if (session.role !== 'barber' && session.role !== 'shop_owner' && session.role !== 'developer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    await query(`UPDATE appointments SET status = 'confirmed', confirmed_at = NOW(), barber_note = $2, updated_at = NOW() WHERE id = $1`, [id, barber_note?.trim() || null])

    // Notify customer
    sendPushToUser(customer.user_id, 'Appointment Confirmed!', `${bp.display_name} confirmed your appointment: ${dateLabel} at ${timeLabel}`, 'calendar_event').catch(() => {})

    // Send confirmation email with payment links
    const shop = await queryOne<{ shop_name: string; address: string | null }>(`SELECT shop_name, address FROM shop_settings WHERE org_id = $1`, [appt.org_id])
    const venmoLink = bp.venmo_username ? `https://venmo.com/${bp.venmo_username}?txn=pay&amount=${appt.total_price}&note=${encodeURIComponent('Haircut')}` : null
    const cashappLink = bp.cashapp_tag ? `https://cash.app/${bp.cashapp_tag}/${appt.total_price}` : null

    const paymentButtons = [
      venmoLink ? `<a href="${venmoLink}" style="display:inline-block;background:#3D95CE;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-right:8px">Pay with Venmo</a>` : '',
      cashappLink ? `<a href="${cashappLink}" style="display:inline-block;background:#00C853;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Pay with Cash App</a>` : '',
    ].filter(Boolean).join('')

    const html = `<div style="font-family:-apple-system,sans-serif;max-width:500px;margin:0 auto">
      <div style="background:#000;padding:20px 24px;border-radius:12px 12px 0 0">
        <h1 style="color:#3B82F6;margin:0;font-size:20px">Appointment Confirmed</h1>
      </div>
      <div style="background:#111;border:1px solid #333;border-top:none;border-radius:0 0 12px 12px;padding:24px;color:white">
        <p style="margin:0 0 16px;font-size:14px">Your appointment has been confirmed!</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
          <tr><td style="padding:6px 0;color:#888;font-size:13px">Barber</td><td style="padding:6px 0;color:white;font-size:13px;font-weight:600">${bp.display_name}</td></tr>
          <tr><td style="padding:6px 0;color:#888;font-size:13px">Date</td><td style="padding:6px 0;color:white;font-size:13px">${dateLabel}</td></tr>
          <tr><td style="padding:6px 0;color:#888;font-size:13px">Time</td><td style="padding:6px 0;color:white;font-size:13px">${timeLabel}</td></tr>
          <tr><td style="padding:6px 0;color:#888;font-size:13px">Price</td><td style="padding:6px 0;color:#3B82F6;font-size:13px;font-weight:600">$${appt.total_price}</td></tr>
          ${shop?.address ? `<tr><td style="padding:6px 0;color:#888;font-size:13px">Location</td><td style="padding:6px 0;color:white;font-size:13px">${shop.address}</td></tr>` : ''}
        </table>
        ${paymentButtons ? `<div style="margin:16px 0">${paymentButtons}</div><p style="font-size:12px;color:#666;margin:8px 0 0">Tipping is always appreciated!</p>` : ''}
        <p style="font-size:11px;color:#555;margin:16px 0 0">Sent from ${shop?.shop_name ?? 'your barbershop'}</p>
      </div>
    </div>`

    sendEmail(customer.email, `Appointment Confirmed — ${dateLabel} at ${timeLabel}`, html).catch(() => {})

  } else if (action === 'decline') {
    await query(`UPDATE appointments SET status = 'declined', decline_reason = $2, proposed_alt_date = $3, proposed_alt_time = $4, updated_at = NOW() WHERE id = $1`,
      [id, decline_reason?.trim() || null, proposed_alt_date || null, proposed_alt_time || null])

    let body = `${bp.display_name} was unable to confirm your appointment for ${dateLabel}.`
    if (proposed_alt_date && proposed_alt_time) {
      const altDate = new Date(proposed_alt_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      const altTime = new Date(`2000-01-01T${proposed_alt_time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      body += ` They suggested ${altDate} at ${altTime} instead.`
    }
    sendPushToUser(customer.user_id, 'Booking Not Confirmed', body, 'calendar_event').catch(() => {})

  } else if (action === 'cancel') {
    // Customer-initiated cancel
    await query(`UPDATE appointments SET status = 'cancelled', customer_cancelled_at = NOW(), updated_at = NOW() WHERE id = $1`, [id])
    sendPushToUser(bp.user_id, 'Appointment Cancelled', `${customer.full_name} cancelled their appointment for ${dateLabel} at ${timeLabel}`, 'calendar_event').catch(() => {})

  } else if (action === 'barber_cancel') {
    // Barber-initiated cancel
    await query(`UPDATE appointments SET status = 'cancelled', decline_reason = $2, updated_at = NOW() WHERE id = $1`, [id, decline_reason?.trim() || null])

    const reason = decline_reason?.trim() ? ` Reason: ${decline_reason.trim()}` : ''
    sendPushToUser(customer.user_id, 'Appointment Cancelled', `${bp.display_name} cancelled your appointment for ${dateLabel} at ${timeLabel}.${reason}`, 'calendar_event').catch(() => {})

    // Email notification
    const shop = await queryOne<{ shop_name: string }>(`SELECT shop_name FROM shop_settings WHERE org_id = $1`, [appt.org_id])
    const html = `<div style="font-family:-apple-system,sans-serif;max-width:500px;margin:0 auto">
      <div style="background:#000;padding:20px 24px;border-radius:12px 12px 0 0">
        <h1 style="color:#EF4444;margin:0;font-size:20px">Appointment Cancelled</h1>
      </div>
      <div style="background:#111;border:1px solid #333;border-top:none;border-radius:0 0 12px 12px;padding:24px;color:white">
        <p style="margin:0 0 16px;font-size:14px">${bp.display_name} has cancelled your appointment.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
          <tr><td style="padding:6px 0;color:#888;font-size:13px">Date</td><td style="padding:6px 0;color:white;font-size:13px">${dateLabel}</td></tr>
          <tr><td style="padding:6px 0;color:#888;font-size:13px">Time</td><td style="padding:6px 0;color:white;font-size:13px">${timeLabel}</td></tr>
          ${decline_reason?.trim() ? `<tr><td style="padding:6px 0;color:#888;font-size:13px">Reason</td><td style="padding:6px 0;color:#aaa;font-size:13px">${decline_reason.trim()}</td></tr>` : ''}
        </table>
        <p style="font-size:13px;color:#aaa">You can rebook anytime through the app.</p>
        <p style="font-size:11px;color:#555;margin:16px 0 0">${shop?.shop_name ?? 'Your barbershop'}</p>
      </div>
    </div>`
    sendEmail(customer.email, `Appointment Cancelled — ${dateLabel}`, html).catch(() => {})

  } else if (action === 'reschedule') {
    // Barber proposes a new time for a confirmed appointment
    await query(`UPDATE appointments SET status = 'declined', decline_reason = $2, proposed_alt_date = $3, proposed_alt_time = $4, updated_at = NOW() WHERE id = $1`,
      [id, decline_reason?.trim() || 'Rescheduling', proposed_alt_date || null, proposed_alt_time || null])

    let body = `${bp.display_name} needs to reschedule your appointment for ${dateLabel} at ${timeLabel}.`
    if (proposed_alt_date && proposed_alt_time) {
      const altDateLabel = new Date(proposed_alt_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      const altTimeLabel = new Date(`2000-01-01T${proposed_alt_time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      body += ` New suggested time: ${altDateLabel} at ${altTimeLabel}.`
    }
    sendPushToUser(customer.user_id, 'Appointment Rescheduled', body, 'calendar_event').catch(() => {})

    // Email with action buttons
    const shop = await queryOne<{ shop_name: string }>(`SELECT shop_name FROM shop_settings WHERE org_id = $1`, [appt.org_id])
    const altDateLabel = proposed_alt_date ? new Date(proposed_alt_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : ''
    const altTimeLabel = proposed_alt_time ? new Date(`2000-01-01T${proposed_alt_time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
    const respondUrl = `https://fieldmanagerpro.app/respond/${id}`
    const html = `<div style="font-family:-apple-system,sans-serif;max-width:500px;margin:0 auto">
      <div style="background:#000;padding:20px 24px;border-radius:12px 12px 0 0">
        <h1 style="color:#F59E0B;margin:0;font-size:20px">Reschedule Request</h1>
      </div>
      <div style="background:#111;border:1px solid #333;border-top:none;border-radius:0 0 12px 12px;padding:24px;color:white">
        <p style="margin:0 0 16px;font-size:14px">${bp.display_name} needs to reschedule your appointment.</p>
        <p style="margin:0 0 4px;font-size:12px;color:#888">Original time:</p>
        <p style="margin:0 0 16px;font-size:13px;color:#666;text-decoration:line-through">${dateLabel} at ${timeLabel}</p>
        ${proposed_alt_date && proposed_alt_time ? `
          <p style="margin:0 0 4px;font-size:12px;color:#3B82F6;font-weight:600">Suggested new time:</p>
          <p style="margin:0 0 20px;font-size:17px;color:white;font-weight:700">${altDateLabel} at ${altTimeLabel}</p>
        ` : ''}
        ${decline_reason?.trim() && decline_reason.trim() !== 'Rescheduling' ? `<p style="font-size:13px;color:#aaa;margin:0 0 20px">"${decline_reason.trim()}"</p>` : ''}
        <div style="margin:0 0 16px">
          <a href="${respondUrl}" style="display:inline-block;background:#3B82F6;color:white;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;margin-right:8px">Accept New Time</a>
          <a href="${respondUrl}" style="display:inline-block;background:#27272a;color:#d4d4d8;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;border:1px solid #3f3f46">Pick Different Time</a>
        </div>
        <p style="font-size:11px;color:#555;margin:16px 0 0">${shop?.shop_name ?? 'Your barbershop'}</p>
      </div>
    </div>`
    sendEmail(customer.email, `${bp.display_name} wants to reschedule — ${altDateLabel} at ${altTimeLabel}`, html).catch(() => {})

  } else if (action === 'complete') {
    await query(`UPDATE appointments SET status = 'completed', barber_note = $2, updated_at = NOW() WHERE id = $1`, [id, barber_note?.trim() || null])
  }

  return NextResponse.json({ ok: true })
}
