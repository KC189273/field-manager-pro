import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { query, queryOne } from '@/lib/db'
import { sendEmail, passwordResetHtml } from '@/lib/notifications'

export async function POST(req: NextRequest) {
  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  // Always respond with success to prevent email enumeration
  const user = await queryOne<{ id: string; full_name: string; email: string }>(
    `SELECT id, full_name, email FROM users WHERE LOWER(email) = LOWER($1) AND is_active = TRUE`,
    [email.trim()]
  )

  if (user) {
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    // Invalidate any existing unused tokens for this user
    await query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    )

    await query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, token, expiresAt.toISOString()]
    )

    const appUrl = process.env.APP_URL ?? 'https://fieldmanagerpro.app'
    const resetUrl = `${appUrl}/reset-password?token=${token}`

    await sendEmail(
      user.email,
      'Reset your Field Manager Pro password',
      passwordResetHtml(user.full_name, resetUrl)
    )
  }

  return NextResponse.json({ ok: true })
}
