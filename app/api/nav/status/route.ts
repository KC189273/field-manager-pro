import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const CHAT_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

/**
 * Combined NavBar status endpoint — replaces 3 separate calls
 * (/api/notifications + /api/chat/unread + /api/clock/status) with one.
 * All queries run in parallel, cutting page-load DB round-trips from 7+ to 3.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [notifRows, chatResult, shiftResult] = await Promise.all([
    // Notifications
    query<{ id: string; title: string; body: string; type: string | null; read: boolean; created_at: string }>(
      `SELECT id, title, body, type, read, created_at::text
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [session.id]
    ).catch(() => [] as { id: string; title: string; body: string; type: string | null; read: boolean; created_at: string }[]),

    // Chat unread (only for roles that have chat access)
    CHAT_ROLES.includes(session.role)
      ? queryOne<{ unread: string }>(
          `SELECT COUNT(*)::text AS unread
           FROM chat_messages m
           JOIN chat_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
           WHERE m.sender_id != $1
             AND m.created_at > cp.last_read_at
             AND cp.muted = FALSE`,
          [session.id]
        ).catch(() => null)
      : Promise.resolve(null),

    // Active shift (NavBar only needs to know if one exists for GPS tracking)
    queryOne<{ id: string }>(
      `SELECT id FROM shifts WHERE user_id = $1 AND clock_out_at IS NULL LIMIT 1`,
      [session.id]
    ).catch(() => null),
  ])

  const unread = notifRows.filter(r => !r.read).length

  return NextResponse.json(
    {
      notifications: notifRows,
      unread,
      chatUnread: parseInt(chatResult?.unread ?? '0'),
      activeShift: shiftResult ?? null,
    },
    {
      headers: {
        // 20-second browser cache — reduces repeated hits; stale-while-revalidate
        // means the browser serves the cached version instantly while refreshing in background
        'Cache-Control': 'private, max-age=20, stale-while-revalidate=40',
      },
    }
  )
}

// Mark all notifications as read
export async function PATCH() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await query(
    `UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`,
    [session.id]
  ).catch(() => {})

  return NextResponse.json({ ok: true })
}
