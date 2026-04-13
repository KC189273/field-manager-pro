import { NextResponse } from 'next/server'
import { getSession, createSession, setSessionCookie } from '@/lib/auth'

// Silently renews the session cookie so mobile users don't get logged out
export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })

  const token = await createSession(session)
  await setSessionCookie(token)

  return NextResponse.json({ ok: true })
}
