import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { queryOne } from '@/lib/db'
import { createSession, setSessionCookie } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { username, password } = await req.json()
  if (!username || !password) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const user = await queryOne<{ id: string; username: string; email: string; full_name: string; role: string; password_hash: string; is_active: boolean; org_id: string | null }>(
    'SELECT * FROM users WHERE username = $1', [username.trim().toLowerCase()]
  )
  if (!user || !user.is_active) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })

  const ok = await bcrypt.compare(password, user.password_hash)
  if (!ok) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })

  const token = await createSession({
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    email: user.email,
    role: user.role as never,
    org_id: user.org_id,
  })
  await setSessionCookie(token)
  return NextResponse.json({ username: user.username, role: user.role, fullName: user.full_name })
}
