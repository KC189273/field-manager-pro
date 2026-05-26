import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { queryOne } from '@/lib/db'

const CHAT_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ unread: 0 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ unread: 0 })

  const result = await queryOne<{ unread: string }>(`
    SELECT COUNT(*)::text AS unread
    FROM chat_messages m
    JOIN chat_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
    WHERE m.sender_id != $1
      AND m.created_at > cp.last_read_at
      AND cp.muted = FALSE
  `, [session.id]).catch(() => null)

  return NextResponse.json({ unread: parseInt(result?.unread ?? '0') })
}
