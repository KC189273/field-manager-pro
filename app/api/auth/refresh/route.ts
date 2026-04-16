import { NextResponse } from 'next/server'
import { getSession, createSession, setSessionCookie } from '@/lib/auth'
import { queryOne } from '@/lib/db'

// Silently renews the session cookie and re-reads role/org from the database
// so role changes take effect within 10 minutes without requiring a sign-out
export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })

  // Re-read current role and org from DB in case an admin changed them
  const user = await queryOne<{ role: string; org_id: string | null }>(
    `SELECT role, org_id FROM users WHERE id = $1 AND is_active = TRUE`,
    [session.id]
  )

  // If user was deactivated, invalidate their session
  if (!user) return NextResponse.json({ ok: false }, { status: 401 })

  const updated = { ...session, role: user.role as typeof session.role, org_id: user.org_id }
  const token = await createSession(updated)
  await setSessionCookie(token)

  return NextResponse.json({ ok: true })
}
