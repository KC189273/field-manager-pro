import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager, isOwner, type Role } from '@/lib/auth'
import { query } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'

const canManage = (role: Role) => isManager(role) || isOwner(role) || role === 'developer'

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS pay_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      type VARCHAR(10) NOT NULL CHECK (type IN ('pto', 'sick')),
      hours NUMERIC(5,2),
      note TEXT,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_pay_codes_user_date ON pay_codes(user_id, date)`)
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const team = searchParams.get('team') === 'true'

  try {
    await ensureTable()
  } catch {
    return NextResponse.json({ codes: [] })
  }

  if (team) {
    if (!canManage(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const params: unknown[] = []
    let sql = `
      SELECT pc.*, u.full_name, u.username
      FROM pay_codes pc
      JOIN users u ON u.id = pc.user_id
      WHERE u.role != 'developer'
    `

    if (isManager(session.role)) {
      params.push(session.id)
      sql += ` AND u.manager_id = $${params.length}`
    } else {
      const orgFilter = await getOrgFilter(session)
      sql += appendOrgFilter(orgFilter, params, 'u')
    }

    if (from) { params.push(from); sql += ` AND pc.date >= $${params.length}` }
    if (to) { params.push(to); sql += ` AND pc.date <= $${params.length}` }
    sql += ` ORDER BY u.full_name, pc.date`

    try {
      const codes = await query(sql, params)
      return NextResponse.json({ codes })
    } catch {
      return NextResponse.json({ codes: [] })
    }
  }

  const userId = searchParams.get('userId') ?? session.id
  if (userId !== session.id && !canManage(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const params: unknown[] = [userId]
  let sql = `SELECT pc.*, u.full_name FROM pay_codes pc JOIN users u ON u.id = pc.user_id WHERE pc.user_id = $1`
  if (from) { params.push(from); sql += ` AND pc.date >= $${params.length}` }
  if (to) { params.push(to); sql += ` AND pc.date <= $${params.length}` }
  sql += ` ORDER BY pc.date`

  try {
    const codes = await query(sql, params)
    return NextResponse.json({ codes })
  } catch {
    return NextResponse.json({ codes: [] })
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManage(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId, date, type, hours, note } = await req.json()
  if (!userId || !date || !type) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  if (!['pto', 'sick'].includes(type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  await query(
    `INSERT INTO pay_codes (user_id, date, type, hours, note, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, date, type, type === 'pto' ? (hours ?? null) : null, note ?? null, session.id]
  )

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManage(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  await query(`DELETE FROM pay_codes WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
