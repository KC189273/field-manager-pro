import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getSession, isManager } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendEmail, welcomeEmailHtml } from '@/lib/notifications'

export async function GET() {
  const session = await getSession()
  if (!session || (!isManager(session.role) && session.role !== 'developer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (session.role === 'developer') {
    // Developer sees everyone
    const users = await query(
      `SELECT id, username, email, full_name, role, is_active, manager_id, created_at
       FROM users ORDER BY role, full_name`
    )
    return NextResponse.json({ users })
  }

  // Manager sees only their assigned employees
  const users = await query(
    `SELECT id, username, email, full_name, role, is_active, manager_id, created_at
     FROM users WHERE manager_id = $1 AND role = 'employee' ORDER BY full_name`,
    [session.id]
  )
  return NextResponse.json({ users })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || (!isManager(session.role) && session.role !== 'developer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { username, email, fullName, password, role, managerId } = await req.json()
  if (!username || !email || !fullName || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Managers can only create employees; developer can create managers too
  const allowedRoles = session.role === 'developer'
    ? ['employee', 'manager', 'ops_manager']
    : ['employee']
  if (role && !allowedRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const finalRole = role ?? 'employee'

  // Determine manager_id
  let finalManagerId: string | null = null
  if (finalRole === 'employee') {
    if (session.role === 'developer' && managerId) {
      finalManagerId = managerId
    } else if (isManager(session.role)) {
      finalManagerId = session.id
    }
  }

  const existing = await queryOne(`SELECT id FROM users WHERE username = $1`, [username.trim().toLowerCase()])
  if (existing) return NextResponse.json({ error: 'Username already taken' }, { status: 409 })

  const hash = await bcrypt.hash(password, 12)
  const user = await queryOne<{ id: string }>(
    `INSERT INTO users (username, email, password_hash, role, full_name, manager_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [username.trim().toLowerCase(), email.trim(), hash, finalRole, fullName.trim(), finalManagerId, session.id]
  )

  await sendEmail(
    email.trim(),
    'Welcome to Field Manager Pro',
    welcomeEmailHtml(fullName.trim(), username.trim().toLowerCase(), password, finalRole)
  )

  return NextResponse.json({ ok: true, id: user!.id })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || (!isManager(session.role) && session.role !== 'developer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId, isActive, password, fullName, email, managerId, role } = await req.json()
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  // Managers can only edit their own employees
  if (isManager(session.role)) {
    const target = await queryOne<{ manager_id: string }>(
      `SELECT manager_id FROM users WHERE id = $1`, [userId]
    )
    if (!target || target.manager_id !== session.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Role change validation
  if (role !== undefined) {
    const allowedRoles = session.role === 'developer'
      ? ['employee', 'manager', 'ops_manager']
      : ['employee', 'manager', 'ops_manager'] // managers can promote/demote within non-developer roles
    if (!allowedRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    // When promoting to manager, clear their manager_id (managers don't report to managers)
    const clearManagerId = role === 'manager' || role === 'ops_manager'
    await query(
      `UPDATE users SET role = $1${clearManagerId ? ', manager_id = NULL' : ''} WHERE id = $2`,
      [role, userId]
    )
  }

  if (isActive !== undefined) {
    await query(`UPDATE users SET is_active = $1 WHERE id = $2`, [isActive, userId])
  }
  if (password) {
    const hash = await bcrypt.hash(password, 12)
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, userId])
  }
  if (fullName) await query(`UPDATE users SET full_name = $1 WHERE id = $2`, [fullName.trim(), userId])
  if (email) await query(`UPDATE users SET email = $1 WHERE id = $2`, [email.trim(), userId])
  if (managerId !== undefined && session.role === 'developer') {
    await query(`UPDATE users SET manager_id = $1 WHERE id = $2`, [managerId || null, userId])
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || (!isManager(session.role) && session.role !== 'developer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  // Prevent self-deletion
  if (userId === session.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
  }

  // Managers can only delete their own employees
  if (isManager(session.role)) {
    const target = await queryOne<{ manager_id: string; role: string }>(
      `SELECT manager_id, role FROM users WHERE id = $1`, [userId]
    )
    if (!target || target.manager_id !== session.id || target.role !== 'employee') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Null out self-referencing columns before delete
  await query(`UPDATE users SET created_by = NULL WHERE created_by = $1`, [userId])
  await query(`UPDATE shifts SET manual_by = NULL WHERE manual_by = $1`, [userId])
  await query(`UPDATE flags SET resolved_by = NULL WHERE resolved_by = $1`, [userId])

  await query(`DELETE FROM users WHERE id = $1`, [userId])
  return NextResponse.json({ ok: true })
}
