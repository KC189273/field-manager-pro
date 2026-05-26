import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const CHAT_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']
const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮', '🙌', '✅']

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS chat_message_reactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(message_id, user_id, emoji)
    )
  `).catch(() => {})
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { messageId, emoji } = await req.json()
  if (!ALLOWED_EMOJIS.includes(emoji)) return NextResponse.json({ error: 'Invalid emoji' }, { status: 400 })

  await ensureTable()

  // Verify user is a participant in the conversation this message belongs to
  const msg = await queryOne<{ conversation_id: string }>(
    `SELECT conversation_id FROM chat_messages WHERE id = $1`, [messageId]
  )
  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

  const participant = await queryOne(
    `SELECT 1 FROM chat_participants WHERE conversation_id = $1 AND user_id = $2`,
    [msg.conversation_id, session.id]
  )
  if (!participant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const existing = await queryOne(
    `SELECT id FROM chat_message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
    [messageId, session.id, emoji]
  )

  if (existing) {
    await query(
      `DELETE FROM chat_message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [messageId, session.id, emoji]
    )
    return NextResponse.json({ action: 'removed' })
  }

  await query(
    `INSERT INTO chat_message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [messageId, session.id, emoji]
  )
  return NextResponse.json({ action: 'added' })
}
