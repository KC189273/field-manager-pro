import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'

// GET — list appointments
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const barberId = searchParams.get('barberId')

  let where = 'WHERE 1=1'
  const params: unknown[] = []

  if (session.role === 'customer') {
    // Customers see their own appointments
    const cp = await queryOne<{ id: string }>(`SELECT id FROM customer_profiles WHERE user_id = $1`, [session.id])
    if (!cp) return NextResponse.json({ appointments: [] })
    params.push(cp.id)
    where += ` AND a.customer_id = $${params.length}`
  } else if (session.role === 'barber') {
    const bp = await queryOne<{ id: string }>(`SELECT id FROM barber_profiles WHERE user_id = $1`, [session.id])
    if (!bp) return NextResponse.json({ appointments: [] })
    params.push(bp.id)
    where += ` AND a.barber_id = $${params.length}`
  } else if (session.role === 'shop_owner' || session.role === 'developer') {
    params.push(session.org_id)
    where += ` AND a.org_id = $${params.length}`
    if (barberId) { params.push(barberId); where += ` AND a.barber_id = $${params.length}` }
  }

  if (date) { params.push(date); where += ` AND a.appointment_date = $${params.length}` }
  if (from) { params.push(from); where += ` AND a.appointment_date >= $${params.length}` }
  if (to) { params.push(to); where += ` AND a.appointment_date <= $${params.length}` }

  const appointments = await query<{
    id: string; barber_id: string; barber_name: string; customer_id: string; customer_name: string
    customer_phone: string | null; appointment_date: string; start_time: string; end_time: string
    total_price: string; total_duration: number; status: string; barber_note: string | null
    decline_reason: string | null; proposed_alt_date: string | null; proposed_alt_time: string | null
    created_at: string; service_names: string
  }>(`
    SELECT a.id, a.barber_id, bp.display_name as barber_name,
           a.customer_id, u.full_name as customer_name, cp.phone as customer_phone,
           a.appointment_date::text, a.start_time::text, a.end_time::text,
           a.total_price::text, a.total_duration, a.status,
           a.barber_note, a.decline_reason,
           a.proposed_alt_date::text, a.proposed_alt_time::text,
           a.created_at::text,
           COALESCE((SELECT STRING_AGG(bs.name, ', ') FROM barber_services bs WHERE bs.id = ANY(a.service_ids)), 'Haircut') as service_names
    FROM appointments a
    JOIN barber_profiles bp ON bp.id = a.barber_id
    JOIN customer_profiles cp ON cp.id = a.customer_id
    JOIN users u ON u.id = cp.user_id
    ${where}
    ORDER BY a.appointment_date, a.start_time
    LIMIT 200
  `, params)

  return NextResponse.json({ appointments })
}

// POST — create a new appointment request (customer)
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'customer') return NextResponse.json({ error: 'Only customers can book' }, { status: 403 })

  const { barberId, serviceIds, date, startTime } = await req.json()
  if (!barberId || !date || !startTime) return NextResponse.json({ error: 'barberId, date, and startTime required' }, { status: 400 })

  const cp = await queryOne<{ id: string; org_id: string }>(`SELECT id, org_id FROM customer_profiles WHERE user_id = $1`, [session.id])
  if (!cp) return NextResponse.json({ error: 'Customer profile not found' }, { status: 400 })

  const bp = await queryOne<{ id: string; user_id: string; default_duration: number; cleanup_minutes: number }>(`
    SELECT id, user_id, default_duration, cleanup_minutes FROM barber_profiles WHERE id = $1
  `, [barberId])
  if (!bp) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })

  // Calculate total duration and price from services
  let totalDuration = 0
  let totalPrice = 0
  const svcIds = serviceIds?.length ? serviceIds : []

  if (svcIds.length > 0) {
    const services = await query<{ duration_minutes: number; price: number }>(`
      SELECT duration_minutes, price::float FROM barber_services WHERE id = ANY($1) AND barber_id = $2
    `, [svcIds, barberId])
    for (const s of services) { totalDuration += s.duration_minutes; totalPrice += s.price }
  } else {
    totalDuration = bp.default_duration
  }

  // Calculate end time
  const [sh, sm] = startTime.split(':').map(Number)
  const endMins = sh * 60 + sm + totalDuration
  const endTime = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`

  // Check for conflicts
  const conflict = await queryOne(`
    SELECT 1 FROM appointments
    WHERE barber_id = $1 AND appointment_date = $2 AND status IN ('pending', 'confirmed')
      AND start_time < $4 AND end_time > $3
  `, [barberId, date, startTime, endTime])

  if (conflict) return NextResponse.json({ error: 'This time slot is no longer available' }, { status: 409 })

  const [appt] = await query<{ id: string }>(`
    INSERT INTO appointments (org_id, barber_id, customer_id, service_ids, appointment_date, start_time, end_time, total_price, total_duration)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
  `, [cp.org_id, barberId, cp.id, svcIds, date, startTime, endTime, totalPrice, totalDuration])

  // Notify barber
  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const timeLabel = new Date(`2000-01-01T${startTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  sendPushToUser(bp.user_id, 'New Booking Request', `${session.fullName} wants to book ${dateLabel} at ${timeLabel}`, 'calendar_event').catch(() => {})

  return NextResponse.json({ ok: true, id: appt.id })
}
