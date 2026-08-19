import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

// POST — user rates a resolved conversation (thumbs up/down)
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { conversationId, rating } = await req.json()
  if (!conversationId || !['up', 'down'].includes(rating)) {
    return NextResponse.json({ error: 'conversationId and rating (up/down) required' }, { status: 400 })
  }

  await query(`ALTER TABLE support_conversations ADD COLUMN IF NOT EXISTS satisfaction_rating TEXT`).catch(() => {})

  const conv = await queryOne<{ user_id: string }>(`SELECT user_id FROM support_conversations WHERE id = $1`, [conversationId])
  if (!conv || conv.user_id !== session.id) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  await query(`UPDATE support_conversations SET satisfaction_rating = $1 WHERE id = $2`, [rating, conversationId])

  return NextResponse.json({ ok: true })
}
