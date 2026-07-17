import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const DEFAULT_WEEK = '1970-01-01'

// Get Monday of the week containing a given date
function getMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? 6 : day - 1 // days since Monday
  d.setDate(d.getDate() - diff)
  return d.toISOString().split('T')[0]
}

// GET — get barber availability for a specific week + available slots for a date
// No auth required — customers access this from email reschedule links and booking
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const barberId = searchParams.get('barberId')
  const date = searchParams.get('date') // specific date to get available slots
  const weekStart = searchParams.get('weekStart') // specific week to load hours for

  if (!barberId) return NextResponse.json({ error: 'barberId required' }, { status: 400 })

  // Determine which week to load
  const targetWeek = weekStart || (date ? getMonday(date) : null)

  // Try week-specific hours first, fall back to default
  let availability = await query<{ day_of_week: number; start_time: string; end_time: string; is_available: boolean; week_start: string; block_index: number }>(`
    SELECT day_of_week, start_time::text, end_time::text, is_available, week_start::text, block_index
    FROM barber_availability WHERE barber_id = $1 AND week_start = $2 ORDER BY day_of_week, block_index
  `, [barberId, targetWeek || DEFAULT_WEEK])

  // If no week-specific hours found, fall back to default
  let usingDefault = false
  if (availability.length === 0 && targetWeek && targetWeek !== DEFAULT_WEEK) {
    availability = await query(`
      SELECT day_of_week, start_time::text, end_time::text, is_available, week_start::text, block_index
      FROM barber_availability WHERE barber_id = $1 AND week_start = $2 ORDER BY day_of_week, block_index
    `, [barberId, DEFAULT_WEEK])
    usingDefault = true
  }

  // Also get list of weeks that have custom hours set
  const customWeeks = await query<{ week_start: string }>(`
    SELECT DISTINCT week_start::text FROM barber_availability
    WHERE barber_id = $1 AND week_start != $2
    ORDER BY week_start DESC LIMIT 26
  `, [barberId, DEFAULT_WEEK])

  // If a specific date requested, calculate available time slots
  let slots: Array<{ time: string; available: boolean }> = []
  if (date) {
    const bp = await queryOne<{ default_duration: number; cleanup_minutes: number }>(`
      SELECT default_duration, cleanup_minutes FROM barber_profiles WHERE id = $1
    `, [barberId])
    if (!bp) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })

    const d = new Date(date + 'T12:00:00')
    const dow = d.getDay()
    const dayIdx = dow === 0 ? 6 : dow - 1

    // For slot calculation, check week-specific first, then default
    // Supports multiple time blocks per day
    const dateWeek = getMonday(date)
    let dayBlocks = await query<{ start_time: string; end_time: string; is_available: boolean }>(`
      SELECT start_time::text, end_time::text, is_available FROM barber_availability
      WHERE barber_id = $1 AND day_of_week = $2 AND week_start = $3
      ORDER BY start_time
    `, [barberId, dayIdx, dateWeek])

    if (dayBlocks.length === 0) {
      dayBlocks = await query(`
        SELECT start_time::text, end_time::text, is_available FROM barber_availability
        WHERE barber_id = $1 AND day_of_week = $2 AND week_start = $3
        ORDER BY start_time
      `, [barberId, dayIdx, DEFAULT_WEEK])
    }

    const activeBlocks = dayBlocks.filter(b => b.is_available)
    if (activeBlocks.length > 0) {
      const booked = await query<{ start_time: string; end_time: string }>(`
        SELECT start_time::text, end_time::text FROM appointments
        WHERE barber_id = $1 AND appointment_date = $2 AND status IN ('pending', 'confirmed')
        ORDER BY start_time
      `, [barberId, date])

      // 1-hour cutoff for today (Central time since Vercel runs UTC)
      const nowCentral = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))
      const todayCentral = `${nowCentral.getFullYear()}-${String(nowCentral.getMonth() + 1).padStart(2, '0')}-${String(nowCentral.getDate()).padStart(2, '0')}`
      let cutoffMins = 0
      if (date === todayCentral) {
        cutoffMins = nowCentral.getHours() * 60 + nowCentral.getMinutes() + 60
      }

      const slotDuration = bp.default_duration + bp.cleanup_minutes

      for (const block of activeBlocks) {
        const [bsh, bsm] = block.start_time.split(':').map(Number)
        const [beh, bem] = block.end_time.split(':').map(Number)
        const blockStart = bsh * 60 + bsm
        const blockEnd = beh * 60 + bem

        for (let m = blockStart; m + bp.default_duration <= blockEnd; m += slotDuration) {
          if (date === todayCentral && m < cutoffMins) continue

          const slotTime = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
          const slotEndMins = m + bp.default_duration

          const isBooked = booked.some(b => {
            const [bs1, bs2] = b.start_time.split(':').map(Number)
            const [be1, be2] = b.end_time.split(':').map(Number)
            return m < (be1 * 60 + be2) && slotEndMins > (bs1 * 60 + bs2)
          })

          if (!isBooked) slots.push({ time: slotTime, available: true })
        }
      }
    }
  }

  return NextResponse.json({
    availability: availability.map(a => ({ day_of_week: a.day_of_week, start_time: a.start_time, end_time: a.end_time, is_available: a.is_available, block_index: a.block_index })),
    slots,
    usingDefault,
    customWeeks: customWeeks.map(w => w.week_start),
  })
}

// POST — save barber availability for a specific week
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['barber', 'shop_owner', 'developer'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { barberId, availability, weekStart, cloneFrom } = await req.json()
  if (!barberId || !Array.isArray(availability)) {
    return NextResponse.json({ error: 'barberId and availability array required' }, { status: 400 })
  }

  // Verify ownership
  const bp = await queryOne<{ user_id: string; org_id: string }>(`SELECT user_id, org_id FROM barber_profiles WHERE id = $1`, [barberId])
  if (!bp) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
  if (session.role === 'barber' && bp.user_id !== session.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (session.role === 'shop_owner' && bp.org_id !== session.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const week = weekStart || DEFAULT_WEEK

  // If cloning from another week, copy that week's data first
  if (cloneFrom) {
    // Clear existing blocks for this week first
    await query(`DELETE FROM barber_availability WHERE barber_id = $1 AND week_start = $2`, [barberId, week])
    const sourceRows = await query<{ day_of_week: number; start_time: string; end_time: string; is_available: boolean; block_index: number }>(`
      SELECT day_of_week, start_time::text, end_time::text, is_available, block_index
      FROM barber_availability WHERE barber_id = $1 AND week_start = $2
    `, [barberId, cloneFrom])

    for (const row of sourceRows) {
      await query(`
        INSERT INTO barber_availability (barber_id, day_of_week, start_time, end_time, is_available, week_start, block_index)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (barber_id, day_of_week, week_start, block_index) DO UPDATE SET
          start_time = $3, end_time = $4, is_available = $5
      `, [barberId, row.day_of_week, row.start_time, row.end_time, row.is_available, week, row.block_index])
    }
  }

  // Save the availability entries (supports multiple blocks per day via block_index)
  // Delete existing rows for this week first, then insert fresh
  if (availability.length > 0) {
    await query(`DELETE FROM barber_availability WHERE barber_id = $1 AND week_start = $2`, [barberId, week])
    for (const day of availability as Array<{ day_of_week: number; start_time: string; end_time: string; is_available: boolean; block_index?: number }>) {
      await query(`
        INSERT INTO barber_availability (barber_id, day_of_week, start_time, end_time, is_available, week_start, block_index)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [barberId, day.day_of_week, day.start_time, day.end_time, day.is_available, week, day.block_index ?? 0])
    }
  }

  return NextResponse.json({ ok: true })
}
