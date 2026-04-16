import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { query, queryOne } from '@/lib/db'

export async function POST(req: NextRequest) {
  const { token, password } = await req.json()
  if (!token || !password) {
    return NextResponse.json({ error: 'Token and password are required' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const row = await queryOne<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    `SELECT id, user_id, expires_at::text, used_at::text FROM password_reset_tokens WHERE token = $1`,
    [token]
  )

  if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This reset link is invalid or has expired.' }, { status: 400 })
  }

  const hash = await bcrypt.hash(password, 12)

  await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, row.user_id])
  await query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [row.id])

  return NextResponse.json({ ok: true })
}
