import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUsers } from '@/lib/apns'

async function ensureBreaksTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS shift_breaks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      break_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      break_end TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action } = await req.json()
  if (action !== 'start' && action !== 'end') {
    return NextResponse.json({ error: 'action must be "start" or "end"' }, { status: 400 })
  }

  try { await ensureBreaksTable() } catch {}

  const shift = await queryOne<{ id: string }>(
    `SELECT id FROM shifts WHERE user_id = $1 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL`,
    [session.id]
  )
  if (!shift) return NextResponse.json({ error: 'No active shift' }, { status: 404 })

  if (action === 'start') {
    const activeBreak = await queryOne(
      `SELECT id FROM shift_breaks WHERE shift_id = $1 AND break_end IS NULL`,
      [shift.id]
    )
    if (activeBreak) return NextResponse.json({ error: 'Already on break' }, { status: 409 })

    await query(
      `INSERT INTO shift_breaks (shift_id, user_id) VALUES ($1, $2)`,
      [shift.id, session.id]
    )
    return NextResponse.json({ ok: true, action: 'started' })
  }

  // action === 'end'
  const activeBreak = await queryOne<{ id: string; break_start: string }>(
    `SELECT id, break_start FROM shift_breaks WHERE shift_id = $1 AND break_end IS NULL`,
    [shift.id]
  )
  if (!activeBreak) return NextResponse.json({ error: 'Not on break' }, { status: 404 })

  await query(`UPDATE shift_breaks SET break_end = NOW() WHERE id = $1`, [activeBreak.id])

  const breakMinutes = (Date.now() - new Date(activeBreak.break_start).getTime()) / 60000

  // Get manager for notifications
  const manager = await queryOne<{ id: string }>(
    `SELECT u2.id FROM users u1
     JOIN users u2 ON u2.id = u1.manager_id
     WHERE u1.id = $1 AND u2.is_active = TRUE`,
    [session.id]
  )

  const flagsRaised: string[] = []

  // Flag: break > 45 minutes
  if (breakMinutes > 45) {
    try {
      await query(
        `INSERT INTO flags (user_id, shift_id, type, date, detail)
         VALUES ($1, $2, 'break_long', CURRENT_DATE, $3)`,
        [session.id, shift.id, `Break lasted ${Math.round(breakMinutes)} min (45 min limit)`]
      )
      flagsRaised.push('break_long')
    } catch {}
  }

  // Count completed breaks for this shift
  const breakCount = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count FROM shift_breaks WHERE shift_id = $1 AND break_end IS NOT NULL`,
    [shift.id]
  )
  const totalBreaks = parseInt(breakCount?.count ?? '0')

  // Flag: more than 1 break per shift (flag once on the 2nd break)
  if (totalBreaks >= 2) {
    const existing = await queryOne(
      `SELECT id FROM flags WHERE shift_id = $1 AND type = 'break_multiple'`,
      [shift.id]
    )
    if (!existing) {
      try {
        await query(
          `INSERT INTO flags (user_id, shift_id, type, date, detail)
           VALUES ($1, $2, 'break_multiple', CURRENT_DATE, $3)`,
          [session.id, shift.id, `${totalBreaks} breaks taken this shift`]
        )
        flagsRaised.push('break_multiple')
      } catch {}
    }
  }

  // Push notification to manager if flags raised
  if (flagsRaised.length > 0 && manager) {
    const msg = flagsRaised.includes('break_long')
      ? `${session.fullName} took a ${Math.round(breakMinutes)}-min break`
      : `${session.fullName} has taken ${totalBreaks} breaks this shift`
    await sendPushToUsers([manager.id], 'Break Alert', msg, 'flag_created').catch(() => {})
  }

  return NextResponse.json({ ok: true, action: 'ended', breakMinutes: Math.round(breakMinutes), flagsRaised })
}
