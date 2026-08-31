import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'
import { sendPushToUsers } from '@/lib/apns'

// POST — send a push notification to all active users (developer/owner only)
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !['developer', 'owner'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { title, body, roles } = await req.json()
  if (!title || !body) {
    return NextResponse.json({ error: 'title and body required' }, { status: 400 })
  }

  // Default to all retail roles if not specified
  const targetRoles = roles || ['employee', 'manager', 'ops_field_leader', 'ops_manager', 'owner', 'sales_director', 'developer']

  const orgId = session.org_id
  const users = await query<{ id: string }>(
    `SELECT id FROM users WHERE is_active = TRUE AND role = ANY($1::text[])${orgId ? ' AND org_id = $2' : ''}`,
    orgId ? [targetRoles, orgId] : [targetRoles]
  )

  if (users.length === 0) {
    return NextResponse.json({ error: 'No users to notify' }, { status: 404 })
  }

  await sendPushToUsers(users.map(u => u.id), title, body)

  return NextResponse.json({ ok: true, count: users.length })
}
