import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendEmail, flagAlertHtml } from '@/lib/notifications'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lat, lng, address } = await req.json()
  if (!lat || !lng) return NextResponse.json({ error: 'GPS coordinates required' }, { status: 400 })

  const shift = await queryOne<{ id: string; clock_in_at: string }>(
    `SELECT id, clock_in_at FROM shifts
     WHERE user_id = $1 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL`,
    [session.id]
  )
  if (!shift) return NextResponse.json({ error: 'No active shift' }, { status: 404 })

  await query(
    `UPDATE shifts SET clock_out_at = NOW(), clock_out_lat = $1, clock_out_lng = $2, clock_out_address = $3
     WHERE id = $4`,
    [lat, lng, address ?? null, shift.id]
  )

  // Record final breadcrumb
  await query(
    `INSERT INTO gps_breadcrumbs (shift_id, user_id, lat, lng, recorded_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [shift.id, session.id, lat, lng]
  )

  // Check for overtime (>40h this week)
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1)
  weekStart.setHours(0, 0, 0, 0)

  const hoursResult = await queryOne<{ total_seconds: number }>(
    `SELECT EXTRACT(EPOCH FROM SUM(clock_out_at - clock_in_at)) as total_seconds
     FROM shifts
     WHERE user_id = $1 AND clock_in_at >= $2 AND clock_out_at IS NOT NULL`,
    [session.id, weekStart.toISOString()]
  )
  const totalHours = (hoursResult?.total_seconds ?? 0) / 3600

  if (totalHours > 40) {
    const existing = await queryOne(
      `SELECT id FROM flags WHERE user_id = $1 AND type = 'overtime' AND date >= $2`,
      [session.id, weekStart.toISOString().split('T')[0]]
    )
    if (!existing) {
      await query(
        `INSERT INTO flags (user_id, shift_id, type, date, detail) VALUES ($1, $2, 'overtime', CURRENT_DATE, $3)`,
        [session.id, shift.id, `${totalHours.toFixed(1)} hours this week`]
      )
      const managers = await query<{ email: string }>(
        `SELECT email FROM users WHERE role IN ('manager','ops_manager') AND is_active = TRUE`
      )
      for (const m of managers) {
        await sendEmail(m.email, `FMP: Overtime — ${session.fullName}`,
          flagAlertHtml(session.fullName, 'Overtime', new Date().toLocaleDateString(),
            `${totalHours.toFixed(1)} hours logged this week (40h limit)`)
        )
      }
    }
  }

  return NextResponse.json({ ok: true })
}
