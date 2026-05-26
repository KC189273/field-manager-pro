import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

const CHAT_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const participant = await queryOne<{ muted: boolean }>(
    `SELECT muted FROM chat_participants WHERE conversation_id = $1 AND user_id = $2`,
    [id, session.id]
  )
  if (!participant) return NextResponse.json({ error: 'Not a participant' }, { status: 403 })

  const newMuted = !participant.muted

  await query(
    `UPDATE chat_participants SET muted = $1 WHERE conversation_id = $2 AND user_id = $3`,
    [newMuted, id, session.id]
  )

  return NextResponse.json({ muted: newMuted })
}
