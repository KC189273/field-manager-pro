import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { query, queryOne } from '@/lib/db'
import { createSession, setSessionCookie } from '@/lib/auth'

const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes

let ensured = false
async function ensureRateLimitTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      ip           TEXT PRIMARY KEY,
      failed_count INT NOT NULL DEFAULT 0,
      window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

export async function POST(req: NextRequest) {
  const { username, password } = await req.json()
  if (!username || !password) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown'

  try { await ensureRateLimitTable() } catch { /* already exists */ }

  // Check rate limit
  const attempt = await queryOne<{ failed_count: number; window_start: string }>(
    `SELECT failed_count, window_start FROM login_attempts WHERE ip = $1`, [ip]
  )
  const withinWindow = attempt && (Date.now() - new Date(attempt.window_start).getTime()) < WINDOW_MS
  if (withinWindow && attempt.failed_count >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, { status: 429 })
  }

  const user = await queryOne<{ id: string; username: string; email: string; full_name: string; role: string; password_hash: string; is_active: boolean; org_id: string | null; must_change_password: boolean | null }>(
    `SELECT id, username, email, full_name, role, password_hash, is_active, org_id, must_change_password FROM users WHERE username = $1`, [username.trim().toLowerCase()]
  )

  const ok = user?.is_active && await bcrypt.compare(password, user.password_hash)

  if (!ok) {
    // Increment failure counter, resetting window if expired
    await query(`
      INSERT INTO login_attempts (ip, failed_count, window_start)
      VALUES ($1, 1, NOW())
      ON CONFLICT (ip) DO UPDATE SET
        failed_count = CASE
          WHEN login_attempts.window_start < NOW() - INTERVAL '15 minutes' THEN 1
          ELSE login_attempts.failed_count + 1
        END,
        window_start = CASE
          WHEN login_attempts.window_start < NOW() - INTERVAL '15 minutes' THEN NOW()
          ELSE login_attempts.window_start
        END
    `, [ip])
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  // Success — clear any recorded failures for this IP
  await query(`DELETE FROM login_attempts WHERE ip = $1`, [ip]).catch(() => {})

  const token = await createSession({
    id: user!.id,
    username: user!.username,
    fullName: user!.full_name,
    email: user!.email,
    role: user!.role as never,
    org_id: user!.org_id,
  })
  await setSessionCookie(token)
  return NextResponse.json({
    username: user!.username,
    role: user!.role,
    fullName: user!.full_name,
    mustChangePassword: user!.must_change_password === true,
  })
}
