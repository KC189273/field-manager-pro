import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getReceiptViewUrl } from '@/lib/s3'

const CHAT_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

let ensured = false
async function ensureTables() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      name TEXT,
      type TEXT NOT NULL DEFAULT 'direct',
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {})
  await query(`
    CREATE TABLE IF NOT EXISTS chat_participants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      muted BOOLEAN DEFAULT FALSE,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      last_read_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(conversation_id, user_id)
    )
  `).catch(() => {})
  await query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      sender_id UUID NOT NULL,
      body TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {})
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await ensureTables()

  const conversations = await query<{
    id: string
    name: string | null
    type: string
    created_at: string
    last_message: string | null
    last_message_type: string | null
    last_message_at: string | null
    last_sender_name: string | null
    unread_count: string
    participant_names: string | null
    participant_avatar_key: string | null
    is_muted: boolean
  }>(`
    SELECT
      c.id,
      c.name,
      c.type,
      c.created_at,
      lm.body AS last_message,
      lm.type AS last_message_type,
      lm.created_at AS last_message_at,
      lu.full_name AS last_sender_name,
      cp_me.muted AS is_muted,
      (
        SELECT COUNT(*)::text FROM chat_messages m2
        WHERE m2.conversation_id = c.id
          AND m2.created_at > cp_me.last_read_at
          AND m2.sender_id != $1
      ) AS unread_count,
      (
        SELECT STRING_AGG(u2.full_name, ', ')
        FROM chat_participants cp3
        JOIN users u2 ON u2.id = cp3.user_id
        WHERE cp3.conversation_id = c.id AND cp3.user_id != $1
      ) AS participant_names,
      (
        SELECT u3.avatar_key
        FROM chat_participants cp4
        JOIN users u3 ON u3.id = cp4.user_id
        WHERE cp4.conversation_id = c.id AND cp4.user_id != $1
        LIMIT 1
      ) AS participant_avatar_key
    FROM chat_conversations c
    JOIN chat_participants cp_me ON cp_me.conversation_id = c.id AND cp_me.user_id = $1
    LEFT JOIN LATERAL (
      SELECT body, type, created_at, sender_id FROM chat_messages
      WHERE conversation_id = c.id
      ORDER BY created_at DESC LIMIT 1
    ) lm ON TRUE
    LEFT JOIN users lu ON lu.id = lm.sender_id
    ORDER BY COALESCE(lm.created_at, c.created_at) DESC
  `, [session.id]).catch(() => [])

  // Generate signed avatar URLs for unique keys
  const uniqueKeys = [...new Set(conversations.map(c => c.participant_avatar_key).filter(Boolean))] as string[]
  const keyToUrl: Record<string, string> = {}
  await Promise.all(uniqueKeys.map(async key => {
    keyToUrl[key] = await getReceiptViewUrl(key).catch(() => '')
  }))

  const withAvatars = conversations.map(c => ({
    ...c,
    participant_avatar_key: undefined,
    participant_avatar_url: c.participant_avatar_key ? (keyToUrl[c.participant_avatar_key] ?? null) : null,
  }))

  return NextResponse.json({ conversations: withAvatars })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await ensureTables()

  const { type, participantIds, name } = await req.json()

  if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
    return NextResponse.json({ error: 'No participants provided' }, { status: 400 })
  }

  // For direct messages, check if a conversation already exists between these two users
  if (type === 'direct' || !type) {
    const otherId = participantIds[0]
    const existing = await queryOne<{ id: string }>(`
      SELECT c.id FROM chat_conversations c
      JOIN chat_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
      JOIN chat_participants p2 ON p2.conversation_id = c.id AND p2.user_id = $2
      WHERE c.type = 'direct'
        AND (SELECT COUNT(*) FROM chat_participants WHERE conversation_id = c.id) = 2
      LIMIT 1
    `, [session.id, otherId]).catch(() => null)

    if (existing) return NextResponse.json({ conversation: { id: existing.id } })
  }

  const orgId = session.org_id
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 400 })

  const conv = await queryOne<{ id: string }>(`
    INSERT INTO chat_conversations (org_id, name, type, created_by)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `, [orgId, name?.trim() || null, type || 'direct', session.id])

  if (!conv) return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })

  const allParticipants = [...new Set([session.id, ...participantIds])]
  for (const pid of allParticipants) {
    await query(`
      INSERT INTO chat_participants (conversation_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [conv.id, pid]).catch(() => {})
  }

  return NextResponse.json({ conversation: { id: conv.id } })
}
