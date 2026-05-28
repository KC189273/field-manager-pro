import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CHAT_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

async function getNavData(userId: string, role: string) {
  const [notifRows, chatResult, shiftResult] = await Promise.all([
    query<{ id: string; title: string; body: string; type: string | null; read: boolean; created_at: string }>(
      `SELECT id, title, body, type, read, created_at::text
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    ).catch(() => [] as { id: string; title: string; body: string; type: string | null; read: boolean; created_at: string }[]),

    CHAT_ROLES.includes(role)
      ? queryOne<{ unread: string }>(
          `SELECT COUNT(*)::text AS unread
           FROM chat_messages m
           JOIN chat_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
           WHERE m.sender_id != $1
             AND m.created_at > cp.last_read_at
             AND cp.muted = FALSE`,
          [userId]
        ).catch(() => null)
      : Promise.resolve(null),

    queryOne<{ id: string }>(
      `SELECT id FROM shifts WHERE user_id = $1 AND clock_out_at IS NULL LIMIT 1`,
      [userId]
    ).catch(() => null),
  ])

  return {
    notifications: notifRows,
    unread: notifRows.filter(r => !r.read).length,
    chatUnread: parseInt(chatResult?.unread ?? '0'),
    activeShift: shiftResult ?? null,
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) => {
        try { controller.enqueue(encoder.encode(chunk)) } catch {}
      }

      // Send initial full state immediately so the NavBar populates without waiting
      try {
        const data = await getNavData(session.id, session.role)
        enqueue(`data: ${JSON.stringify(data)}\n\n`)
      } catch {
        enqueue(`data: ${JSON.stringify({ notifications: [], unread: 0, chatUnread: 0, activeShift: null })}\n\n`)
      }

      // Run for 55s then close — EventSource auto-reconnects, picking up fresh state
      const deadline = Date.now() + 55_000
      let ticks = 0

      while (!req.signal.aborted && Date.now() < deadline) {
        await sleep(20_000)
        if (req.signal.aborted) break

        try {
          const data = await getNavData(session.id, session.role)
          enqueue(`id: ${Date.now()}\ndata: ${JSON.stringify(data)}\n\n`)
        } catch {
          // DB hiccup — loop continues
        }

        // Heartbeat comment to keep TCP connection alive through proxies
        ticks++
        if (ticks % 2 === 0) enqueue(': ping\n\n')
      }

      try { controller.close() } catch {}
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
