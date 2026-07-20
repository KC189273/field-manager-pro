import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const CHAT_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  // Verify caller is a participant
  const isMember = await queryOne(
    'SELECT 1 FROM chat_participants WHERE conversation_id = $1 AND user_id = $2',
    [id, session.id]
  )
  if (!isMember) return NextResponse.json({ error: 'Not a participant' }, { status: 403 })

  const members = await query<{ user_id: string; full_name: string; role: string; joined_at: string }>(`
    SELECT cp.user_id, u.full_name, u.role, cp.joined_at::text
    FROM chat_participants cp
    JOIN users u ON u.id = cp.user_id
    WHERE cp.conversation_id = $1
    ORDER BY u.full_name
  `, [id])

  return NextResponse.json({ members })
}

// Add members to a group conversation
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { userIds } = await req.json()

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return NextResponse.json({ error: 'userIds required' }, { status: 400 })
  }

  // Verify it's a group conversation
  const conv = await queryOne<{ type: string }>('SELECT type FROM chat_conversations WHERE id = $1', [id])
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  if (conv.type !== 'group') return NextResponse.json({ error: 'Can only add members to group conversations' }, { status: 400 })

  // Verify caller is a participant
  const isMember = await queryOne(
    'SELECT 1 FROM chat_participants WHERE conversation_id = $1 AND user_id = $2',
    [id, session.id]
  )
  if (!isMember) return NextResponse.json({ error: 'Not a participant' }, { status: 403 })

  // Add each user
  const added: string[] = []
  for (const userId of userIds) {
    const result = await queryOne<{ user_id: string }>(`
      INSERT INTO chat_participants (conversation_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (conversation_id, user_id) DO NOTHING
      RETURNING user_id
    `, [id, userId])
    if (result) added.push(userId)
  }

  // Post system messages for added users
  if (added.length > 0) {
    const names = await query<{ full_name: string }>(
      `SELECT full_name FROM users WHERE id = ANY($1)`,
      [added]
    )
    const nameList = names.map(n => n.full_name).join(', ')
    await queryOne(`
      INSERT INTO chat_messages (conversation_id, sender_id, body, type)
      VALUES ($1, $2, $3, 'system')
    `, [id, session.id, `${session.fullName} added ${nameList}`])
  }

  return NextResponse.json({ added: added.length })
}

// Remove a member from a group conversation
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { userId } = await req.json()

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  // Verify it's a group conversation
  const conv = await queryOne<{ type: string }>('SELECT type FROM chat_conversations WHERE id = $1', [id])
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  if (conv.type !== 'group') return NextResponse.json({ error: 'Can only remove members from group conversations' }, { status: 400 })

  // Verify caller is a participant
  const isMember = await queryOne(
    'SELECT 1 FROM chat_participants WHERE conversation_id = $1 AND user_id = $2',
    [id, session.id]
  )
  if (!isMember) return NextResponse.json({ error: 'Not a participant' }, { status: 403 })

  // Get the name before removing
  const removed = await queryOne<{ full_name: string }>(
    `SELECT u.full_name FROM chat_participants cp JOIN users u ON u.id = cp.user_id WHERE cp.conversation_id = $1 AND cp.user_id = $2`,
    [id, userId]
  )

  await query('DELETE FROM chat_participants WHERE conversation_id = $1 AND user_id = $2', [id, userId])

  // Post system message
  if (removed) {
    await queryOne(`
      INSERT INTO chat_messages (conversation_id, sender_id, body, type)
      VALUES ($1, $2, $3, 'system')
    `, [id, session.id, `${session.fullName} removed ${removed.full_name}`])
  }

  return NextResponse.json({ ok: true })
}
