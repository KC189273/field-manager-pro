import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

let ensured = false
async function ensureColumns() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password TEXT DEFAULT NULL`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE`)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureColumns() } catch {}

  const { newPassword } = await req.json()
  if (!newPassword || newPassword.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  const hash = await bcrypt.hash(newPassword, 12)

  await query(
    `UPDATE users SET password_hash = $1, temp_password = NULL, must_change_password = FALSE WHERE id = $2`,
    [hash, session.id]
  )

  return NextResponse.json({ ok: true })
}
