import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getReceiptViewUrl } from '@/lib/s3'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CHAT_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !CHAT_ROLES.includes(session.role)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const conversationId = searchParams.get('conversationId')
  if (!conversationId) return new Response('Missing conversationId', { status: 400 })

  // On first connect, `after` comes from the query param.
  // On auto-reconnect, EventSource sends Last-Event-ID header (set by our `id:` field),
  // so we pick up exactly where we left off with no missed messages.
  const lastEventId = req.headers.get('last-event-id')
  let after = lastEventId ?? searchParams.get('after') ?? new Date().toISOString()

  // Verify participant before opening the stream
  const participant = await queryOne(
    `SELECT 1 FROM chat_participants WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, session.id]
  ).catch(() => null)
  if (!participant) return new Response('Forbidden', { status: 403 })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (chunk: string) => {
        try { controller.enqueue(encoder.encode(chunk)) } catch {}
      }

      // Confirm connection (client can listen for this to know SSE is live)
      enqueue(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)

      // Run for 55s, just under maxDuration=60. EventSource auto-reconnects seamlessly.
      const deadline = Date.now() + 55_000
      let ticks = 0

      while (!req.signal.aborted && Date.now() < deadline) {
        await sleep(2000)
        if (req.signal.aborted) break

        try {
          const messages = await query<{
            id: string
            sender_id: string
            sender_name: string
            sender_avatar_key: string | null
            body: string
            type: string
            created_at: string
            reply_to_id: string | null
            reply_to_body: string | null
            reply_to_type: string | null
            reply_to_sender_name: string | null
          }>(
            `SELECT m.id, m.sender_id, u.full_name AS sender_name, u.avatar_key AS sender_avatar_key, m.body, m.type, m.created_at,
                    m.reply_to_id, rm.body AS reply_to_body, rm.type AS reply_to_type, ru.full_name AS reply_to_sender_name
             FROM chat_messages m
             JOIN users u ON u.id = m.sender_id
             LEFT JOIN chat_messages rm ON rm.id = m.reply_to_id
             LEFT JOIN users ru ON ru.id = rm.sender_id
             WHERE m.conversation_id = $1 AND m.created_at > $2
             ORDER BY m.created_at ASC`,
            [conversationId, after]
          )

          if (messages.length > 0) {
            // Batch avatar URLs per unique sender
            const uniqueSenders = [...new Map(messages.map(m => [m.sender_id, m.sender_avatar_key])).entries()]
            const senderAvatarUrls: Record<string, string | null> = {}
            await Promise.all(uniqueSenders.map(async ([userId, key]) => {
              senderAvatarUrls[userId] = key ? await getReceiptViewUrl(key).catch(() => null) : null
            }))

            // Sign S3 URLs for image messages + attach avatar URLs
            const processed = await Promise.all(
              messages.map(async (msg) => {
                const base = { ...msg, sender_avatar_key: undefined, sender_avatar_url: senderAvatarUrls[msg.sender_id] ?? null }
                if (msg.type === 'image') {
                  return { ...base, body: await getReceiptViewUrl(msg.body).catch(() => msg.body) }
                }
                return base
              })
            )

            const newAfter = messages[messages.length - 1].created_at
            // The `id:` field becomes Last-Event-ID so reconnects resume from here
            enqueue(`id: ${newAfter}\ndata: ${JSON.stringify({ type: 'messages', messages: processed })}\n\n`)
            after = newAfter

            // Keep unread count accurate while user is actively watching
            await query(
              `UPDATE chat_participants SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2`,
              [conversationId, session.id]
            ).catch(() => {})
          }
        } catch {
          // DB hiccup — loop continues and retries next tick
        }

        // SSE comment heartbeat every ~20s to keep the TCP connection alive through proxies
        ticks++
        if (ticks % 10 === 0) enqueue(': ping\n\n')
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
