import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const canEdit = (role: string) => isManager(role as never) || isOwner(role as never) || role === 'developer'

// POST — create or update a break
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canEdit(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { shiftId, breakId, breakStart, breakEnd } = await req.json()
  if (!shiftId || !breakStart) return NextResponse.json({ error: 'shiftId and breakStart required' }, { status: 400 })

  if (breakId) {
    // Update existing break
    await query(`
      UPDATE shift_breaks SET break_start = $1, break_end = $2 WHERE id = $3
    `, [breakStart, breakEnd ?? null, breakId])
    return NextResponse.json({ ok: true, updated: breakId })
  } else {
    // Create new break
    const row = await queryOne<{ id: string }>(`
      INSERT INTO shift_breaks (shift_id, user_id, break_start, break_end)
      VALUES ($1, (SELECT user_id FROM shifts WHERE id = $1), $2, $3)
      RETURNING id
    `, [shiftId, breakStart, breakEnd ?? null])
    return NextResponse.json({ ok: true, created: row?.id })
  }
}

// DELETE — remove a break
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !canEdit(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { breakId } = await req.json()
  if (!breakId) return NextResponse.json({ error: 'breakId required' }, { status: 400 })

  await query(`DELETE FROM shift_breaks WHERE id = $1`, [breakId])
  return NextResponse.json({ ok: true })
}
