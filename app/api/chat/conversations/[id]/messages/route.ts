import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser } from '@/lib/apns'
import { getReceiptViewUrl } from '@/lib/s3'

const CHAT_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const after = searchParams.get('after') // ISO timestamp for polling

  // Verify user is a participant
  const participant = await queryOne(`
    SELECT 1 FROM chat_participants WHERE conversation_id = $1 AND user_id = $2
  `, [id, session.id]).catch(() => null)
  if (!participant) return NextResponse.json({ error: 'Not a participant' }, { status: 403 })

  const messages = await query<{
    id: string
    sender_id: string
    sender_name: string
    sender_avatar_key: string | null
    body: string
    type: string
    created_at: string
  }>(
    after
      ? `SELECT m.id, m.sender_id, u.full_name AS sender_name, u.avatar_key AS sender_avatar_key, m.body, m.type, m.created_at
         FROM chat_messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = $1 AND m.created_at > $2
         ORDER BY m.created_at ASC`
      : `SELECT m.id, m.sender_id, u.full_name AS sender_name, u.avatar_key AS sender_avatar_key, m.body, m.type, m.created_at
         FROM chat_messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = $1
         ORDER BY m.created_at DESC LIMIT 100`,
    after ? [id, after] : [id]
  ).catch(() => [])

  // Return in ascending order (oldest first) for display
  const ordered = after ? messages : [...messages].reverse()

  // Sign URLs for image messages
  const withUrls = await Promise.all(
    ordered.map(async (msg) => {
      if (msg.type === 'image') {
        const url = await getReceiptViewUrl(msg.body).catch(() => msg.body)
        return { ...msg, body: url }
      }
      return msg
    })
  )

  // Attach reactions (single query for all messages)
  const msgIds = withUrls.map(m => m.id)
  const allReactions = msgIds.length > 0
    ? await query<{ message_id: string; emoji: string; user_id: string; user_name: string }>(
        `SELECT r.message_id, r.emoji, r.user_id, u.full_name AS user_name
         FROM chat_message_reactions r
         JOIN users u ON u.id = r.user_id
         WHERE r.message_id = ANY($1::uuid[])`,
        [msgIds]
      ).catch(() => [])
    : []

  const reactionsByMsg = allReactions.reduce((acc, r) => {
    if (!acc[r.message_id]) acc[r.message_id] = []
    acc[r.message_id].push({ emoji: r.emoji, user_id: r.user_id, user_name: r.user_name })
    return acc
  }, {} as Record<string, { emoji: string; user_id: string; user_name: string }[]>)

  // Batch-generate signed avatar URLs per unique sender
  const uniqueSenders = [...new Map(ordered.map(m => [m.sender_id, m.sender_avatar_key])).entries()]
  const senderAvatarUrls: Record<string, string | null> = {}
  await Promise.all(uniqueSenders.map(async ([userId, key]) => {
    senderAvatarUrls[userId] = key ? await getReceiptViewUrl(key).catch(() => null) : null
  }))

  const withReactions = withUrls.map(msg => ({
    ...msg,
    sender_avatar_key: undefined,
    sender_avatar_url: senderAvatarUrls[msg.sender_id] ?? null,
    reactions: reactionsByMsg[msg.id] ?? [],
  }))

  // Update last_read_at
  await query(`
    UPDATE chat_participants SET last_read_at = NOW()
    WHERE conversation_id = $1 AND user_id = $2
  `, [id, session.id]).catch(() => {})

  // For group chats, return who has muted (visible to manager+ only)
  const MANAGER_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']
  let mutedBy: string[] = []
  if (MANAGER_ROLES.includes(session.role)) {
    const conv = await queryOne<{ type: string }>(
      `SELECT type FROM chat_conversations WHERE id = $1`, [id]
    ).catch(() => null)
    if (conv?.type === 'group') {
      const muters = await query<{ full_name: string }>(
        `SELECT u.full_name FROM chat_participants cp
         JOIN users u ON u.id = cp.user_id
         WHERE cp.conversation_id = $1 AND cp.muted = TRUE`,
        [id]
      ).catch(() => [])
      mutedBy = muters.map(m => m.full_name)
    }
  }

  // Participants for @mention (only on initial load, not polls)
  let participants: { id: string; full_name: string; username: string }[] = []
  if (!after) {
    participants = await query<{ id: string; full_name: string; username: string }>(
      `SELECT u.id, u.full_name, u.username FROM chat_participants cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.conversation_id = $1 AND cp.user_id != $2
       ORDER BY u.full_name`,
      [id, session.id]
    ).catch(() => [])
  }

  // Only include participants on initial load — polls pass `after` and should not overwrite the cached list
  return NextResponse.json({ messages: withReactions, mutedBy, ...(after ? {} : { participants }) })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { body, type } = await req.json()

  if (!body?.trim()) return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  if (type === 'image' && !body.startsWith('chat/')) {
    return NextResponse.json({ error: 'Invalid image key' }, { status: 400 })
  }

  // Verify user is a participant
  const participant = await queryOne(`
    SELECT 1 FROM chat_participants WHERE conversation_id = $1 AND user_id = $2
  `, [id, session.id]).catch(() => null)
  if (!participant) return NextResponse.json({ error: 'Not a participant' }, { status: 403 })

  const message = await queryOne<{ id: string; created_at: string }>(`
    INSERT INTO chat_messages (conversation_id, sender_id, body, type)
    VALUES ($1, $2, $3, $4)
    RETURNING id, created_at
  `, [id, session.id, body.trim(), type || 'text'])

  if (!message) return NextResponse.json({ error: 'Failed to send' }, { status: 500 })

  // Update sender's last_read_at so their own message doesn't count as unread
  await query(`
    UPDATE chat_participants SET last_read_at = NOW()
    WHERE conversation_id = $1 AND user_id = $2
  `, [id, session.id]).catch(() => {})

  // Get conversation name for notification
  const conv = await queryOne<{ name: string | null; type: string }>(`
    SELECT name, type FROM chat_conversations WHERE id = $1
  `, [id]).catch(() => null)

  const notifTitle = conv?.type === 'group' && conv?.name
    ? conv.name
    : session.fullName

  const notifBody = type === 'gif'
    ? `${session.fullName} sent a GIF`
    : type === 'image'
    ? `${session.fullName} sent a photo`
    : body.trim()

  // Get all other participants with mute status and username for mention matching
  const allParticipants = await query<{ user_id: string; full_name: string; username: string; muted: boolean }>(
    `SELECT cp.user_id, u.full_name, u.username, cp.muted FROM chat_participants cp
     JOIN users u ON u.id = cp.user_id
     WHERE cp.conversation_id = $1 AND cp.user_id != $2`,
    [id, session.id]
  ).catch(() => [])

  // Determine mentioned participants by matching @everyone, @full_name, or @username (case-insensitive)
  const bodyLower = body.trim().toLowerCase()
  const isEveryoneMention = bodyLower.includes('@everyone')
  const mentionedIds = isEveryoneMention
    ? new Set(allParticipants.map(p => p.user_id))
    : new Set(
        allParticipants
          .filter(p =>
            bodyLower.includes(`@${p.full_name.toLowerCase()}`) ||
            bodyLower.includes(`@${p.username.toLowerCase()}`)
          )
          .map(p => p.user_id)
      )

  const mentionBody = isEveryoneMention
    ? `${session.fullName} mentioned everyone: ${body.trim()}`
    : `${session.fullName} mentioned you: ${body.trim()}`

  for (const p of allParticipants) {
    if (mentionedIds.has(p.user_id)) {
      // Always push mentioned users, even if muted — with a specific "mentioned you" message
      sendPushToUser(p.user_id, notifTitle, mentionBody, 'chat_message').catch(() => {})
    } else if (!p.muted) {
      // Regular push for non-muted, non-mentioned participants
      sendPushToUser(p.user_id, notifTitle, notifBody, 'chat_message').catch(() => {})
    }
  }

  const responseBody = type === 'image'
    ? await getReceiptViewUrl(body.trim()).catch(() => body.trim())
    : body.trim()

  const senderRow = await queryOne<{ avatar_key: string | null }>(`SELECT avatar_key FROM users WHERE id = $1`, [session.id]).catch(() => null)
  const senderAvatarUrl = senderRow?.avatar_key ? await getReceiptViewUrl(senderRow.avatar_key).catch(() => null) : null

  return NextResponse.json({
    message: {
      id: message.id,
      sender_id: session.id,
      sender_name: session.fullName,
      sender_avatar_url: senderAvatarUrl,
      body: responseBody,
      type: type || 'text',
      created_at: message.created_at,
      reactions: [],
    }
  })
}
