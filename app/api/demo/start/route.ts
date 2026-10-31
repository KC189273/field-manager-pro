import { NextRequest, NextResponse } from 'next/server'
import { createSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { cookies } from 'next/headers'

const DEMO_ORG_ID = 'd8d9b6e9-c706-42ea-87fe-b4f2e08727b7'

function esc(s: string): string {
  return s.replace(/'/g, "''")
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { firstName, lastName, email } = body

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'First name, last name, and email are required' }, { status: 400 })
    }

    const fn = esc(firstName.trim())
    const ln = esc(lastName.trim())
    const em = esc(email.trim().toLowerCase())
    const fullName = `${fn} ${ln}`
    const username = `prospect_${Date.now()}`

    // Save as a demo lead
    await query(`
      INSERT INTO demo_leads (first_name, last_name, email)
      VALUES ('${fn}', '${ln}', '${em}')
    `)

    // Notify developer via push
    const { sendPushToUsers } = await import('@/lib/apns')
    const devs = await query<{ id: string }>(`SELECT id FROM users WHERE role = 'developer' AND is_active = TRUE`)
    if (devs.length) {
      sendPushToUsers(devs.map(d => d.id), 'New Demo Lead',
        `${firstName.trim()} ${lastName.trim()} (${email.trim()}) started the demo`,
        'leads'
      ).catch(() => {})
    }

    // Create a prospect user in the demo org
    const prospectUser = await queryOne<{ id: string }>(`
      INSERT INTO users (org_id, username, password_hash, full_name, legal_name, email, role, is_active)
      VALUES ('${esc(DEMO_ORG_ID)}', '${esc(username)}', 'demo_no_password', '${fullName}', '${fullName}', '${em}', 'prospect', TRUE)
      RETURNING id
    `)

    if (!prospectUser) {
      return NextResponse.json({ error: 'Failed to create demo session' }, { status: 500 })
    }

    // Create JWT session
    const token = await createSession({
      id: prospectUser.id,
      username,
      fullName: `${firstName.trim()} ${lastName.trim()}`,
      email: email.trim().toLowerCase(),
      role: 'prospect',
      org_id: DEMO_ORG_ID,
    })

    const cookieStore = await cookies()
    cookieStore.set('fmp-session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 86400,
      path: '/',
    })

    return NextResponse.json({ ok: true, role: 'prospect' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Demo start error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
