import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getSession, isManager } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session || (!isManager(session.role) && session.role !== 'developer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const users = await query(
    `SELECT id, username, email, full_name, role, is_active, created_at FROM users ORDER BY role, full_name`
  )
  return NextResponse.json({ users })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isManager(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { username, email, fullName, password, role } = await req.json()
  if (!username || !email || !fullName || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  const allowedRoles = ['employee', 'manager', 'ops_manager']
  if (role && !allowedRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const existing = await queryOne(`SELECT id FROM users WHERE username = $1`, [username.trim().toLowerCase()])
  if (existing) return NextResponse.json({ error: 'Username already taken' }, { status: 409 })

  const hash = await bcrypt.hash(password, 12)
  const user = await queryOne<{ id: string }>(
    `INSERT INTO users (username, email, password_hash, role, full_name, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [username.trim().toLowerCase(), email.trim(), hash, role ?? 'employee', fullName.trim(), session.id]
  )
  return NextResponse.json({ ok: true, id: user!.id })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isManager(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId, isActive, password, fullName, email } = await req.json()
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  if (isActive !== undefined) {
    await query(`UPDATE users SET is_active = $1 WHERE id = $2`, [isActive, userId])
  }
  if (password) {
    const hash = await bcrypt.hash(password, 12)
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, userId])
  }
  if (fullName) await query(`UPDATE users SET full_name = $1 WHERE id = $2`, [fullName, userId])
  if (email) await query(`UPDATE users SET email = $1 WHERE id = $2`, [email, userId])

  return NextResponse.json({ ok: true })
}
