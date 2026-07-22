import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { queryOne } from '@/lib/db'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { subject, body } = await req.json()
  if (!subject || !body) return NextResponse.json({ error: 'subject and body required' }, { status: 400 })

  // Get user's org industry
  const org = session.org_id
    ? await queryOne<{ industry: string | null }>('SELECT industry FROM organizations WHERE id = $1', [session.org_id])
    : null

  await queryOne(`
    INSERT INTO support_messages (org_id, user_id, user_name, user_email, industry, subject, body)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    session.org_id ?? null,
    session.id,
    session.fullName,
    session.email,
    org?.industry ?? null,
    subject,
    body,
  ])

  return NextResponse.json({ ok: true })
}
