import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getSession, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendEmail, welcomeEmailHtml } from '@/lib/notifications'
import { sendPushToUser } from '@/lib/apns'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let pwd = ''
  for (let i = 0; i < 8; i++) pwd += chars[Math.floor(Math.random() * chars.length)]
  return pwd
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const canApprove = isOwner(session.role) || session.role === 'ops_manager' || session.role === 'developer'
  if (!canApprove) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId, action } = await req.json()
  if (!userId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const user = await queryOne<{
    id: string; full_name: string; email: string; username: string
    role: string; approval_status: string | null; org_id: string | null
  }>(`SELECT id, full_name, email, username, role, approval_status, org_id FROM users WHERE id = $1`, [userId])

  if (!user || user.approval_status !== 'pending') {
    return NextResponse.json({ error: 'User not found or not pending' }, { status: 404 })
  }

  // Org check — approver must be in same org (developer bypasses)
  if (session.role !== 'developer' && user.org_id !== session.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (action === 'approve') {
    // Generate fresh temp password so the welcome email has valid credentials
    const tempPassword = generateTempPassword()
    const hash = await bcrypt.hash(tempPassword, 12)

    await query(
      `UPDATE users SET is_active = TRUE, approval_status = 'approved', password_hash = $1 WHERE id = $2`,
      [hash, userId]
    )

    await sendEmail(
      user.email,
      'Welcome to Field Manager Pro',
      welcomeEmailHtml(user.full_name, user.username, tempPassword, user.role)
    ).catch(() => {})

    await sendPushToUser(
      user.id,
      'Account Approved',
      'Your Field Manager Pro account has been approved. You can now sign in!',
      'account_approved'
    ).catch(() => {})
  } else {
    // Reject — clean up and delete the pending user
    await query(`UPDATE users SET created_by = NULL WHERE created_by = $1`, [userId])
    await query(`DELETE FROM users WHERE id = $1`, [userId])
  }

  return NextResponse.json({ ok: true })
}
