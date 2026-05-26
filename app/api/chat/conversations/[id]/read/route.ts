import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  await query(`
    UPDATE chat_participants SET last_read_at = NOW()
    WHERE conversation_id = $1 AND user_id = $2
  `, [id, session.id]).catch(() => {})

  return NextResponse.json({ ok: true })
}
