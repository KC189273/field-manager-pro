import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

const CHAT_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const users = await query<{ id: string; full_name: string; role: string }>(
    `SELECT id, full_name, role FROM users
     WHERE is_active = TRUE
       AND role IN ('manager', 'ops_manager', 'owner', 'sales_director', 'developer')
       AND org_id = $1
       AND id != $2
     ORDER BY full_name ASC`,
    [session.org_id, session.id]
  ).catch(() => [])

  return NextResponse.json({ users })
}
