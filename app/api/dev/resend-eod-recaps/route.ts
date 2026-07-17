import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { sendDmEodRecap } from '@/lib/dm-eod-recap'

export const maxDuration = 120

// GET /api/dev/resend-eod-recaps?date=2026-07-14  (or ?from=2026-07-13&to=2026-07-14)
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  const from = searchParams.get('from') ?? date
  const to = searchParams.get('to') ?? date

  if (!from || !to) {
    return NextResponse.json({ error: 'Provide ?date=YYYY-MM-DD or ?from=...&to=...' }, { status: 400 })
  }

  // Find all DM shifts that clocked out in the date range
  const shifts = await query<{
    shift_id: string
    user_id: string
    full_name: string
    email: string
    org_id: string
    clock_in_at: string
    clock_out_at: string
  }>(`
    SELECT s.id AS shift_id, s.user_id, u.full_name, u.email, u.org_id,
           s.clock_in_at::text, s.clock_out_at::text
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    WHERE u.role = 'manager' AND u.is_active = TRUE
      AND (u.is_hidden = FALSE OR u.is_hidden IS NULL)
      AND u.org_id IS NOT NULL
      AND s.clock_out_at IS NOT NULL
      AND s.clock_out_at >= ($1 || ' 00:00:00-06')::timestamptz
      AND s.clock_out_at < (($2::date + 1) || ' 00:00:00-06')::timestamptz
    ORDER BY s.clock_out_at
  `, [from, to])

  if (shifts.length === 0) {
    return NextResponse.json({ ok: true, message: 'No DM shifts found in that range', from, to })
  }

  const results: Array<{ dm: string; shiftId: string; clockOut: string; status: string }> = []

  for (const s of shifts) {
    try {
      await sendDmEodRecap({
        dmId: s.user_id,
        dmName: s.full_name,
        dmEmail: s.email,
        orgId: s.org_id,
        shiftId: s.shift_id,
      })
      results.push({ dm: s.full_name, shiftId: s.shift_id, clockOut: s.clock_out_at, status: 'sent' })
    } catch (err) {
      results.push({ dm: s.full_name, shiftId: s.shift_id, clockOut: s.clock_out_at, status: `error: ${err}` })
    }
  }

  return NextResponse.json({ ok: true, from, to, total: shifts.length, results })
}
