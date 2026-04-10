import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

const COOKIE = 'fmp-dev-org'

export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const jar = await cookies()
  const orgId = jar.get(COOKIE)?.value ?? null
  const orgs = await query<{ id: string; name: string }>(
    `SELECT id, name FROM organizations ORDER BY name`
  )
  return NextResponse.json({ orgId, orgs })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'developer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { orgId } = await req.json()
  const jar = await cookies()
  if (orgId) {
    jar.set(COOKIE, orgId, { httpOnly: false, path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' })
  } else {
    jar.delete(COOKIE)
  }
  return NextResponse.json({ ok: true })
}
