import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter } from '@/lib/org'
import { getReceiptViewUrl } from '@/lib/s3'

const CHAT_ROLES = ['manager', 'ops_manager', 'owner', 'sales_director', 'developer']

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS chat_pinned_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL,
      message_id UUID NOT NULL,
      pinned_by UUID NOT NULL,
      pinned_by_name TEXT NOT NULL,
      pinned_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(conversation_id, message_id)
    )
  `).catch(() => {})
}

// GET ?convId=xxx — list pinned messages with full content
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try { await ensureTable() } catch {}

  const convId = new URL(req.url).searchParams.get('convId')
  if (!convId) return NextResponse.json({ error: 'convId required' }, { status: 400 })

  // Verify participant
  const part = await queryOne(`SELECT 1 FROM chat_participants WHERE conversation_id = $1 AND user_id = $2`, [convId, session.id]).catch(() => null)
  if (!part) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await query<{
    message_id: string; sender_id: string; sender_name: string; sender_avatar_key: string | null
    body: string; type: string; created_at: string; pinned_by_name: string; pinned_at: string
  }>(`
    SELECT m.id AS message_id, m.sender_id, u.full_name AS sender_name, u.avatar_key AS sender_avatar_key,
           m.body, m.type, m.created_at, pm.pinned_by_name, pm.pinned_at
    FROM chat_pinned_messages pm
    JOIN chat_messages m ON m.id = pm.message_id
    JOIN users u ON u.id = m.sender_id
    WHERE pm.conversation_id = $1
    ORDER BY pm.pinned_at DESC
  `, [convId]).catch(() => [])

  // Sign URLs
  const withUrls = await Promise.all(rows.map(async (row) => {
    if (row.type === 'image') {
      const url = await getReceiptViewUrl(row.body).catch(() => row.body)
      return { ...row, body: url }
    }
    if (row.type === 'file') {
      const sepIdx = row.body.indexOf('|||')
      const key = sepIdx >= 0 ? row.body.slice(0, sepIdx) : row.body
      const name = sepIdx >= 0 ? row.body.slice(sepIdx + 3) : ''
      const url = await getReceiptViewUrl(key).catch(() => key)
      return { ...row, body: `${url}|||${name}` }
    }
    return row
  }))

  // Sign avatar URLs
  const avatarUrls: Record<string, string | null> = {}
  await Promise.all(withUrls.map(async (row) => {
    if (avatarUrls[row.sender_id] !== undefined) return
    avatarUrls[row.sender_id] = row.sender_avatar_key
      ? await getReceiptViewUrl(row.sender_avatar_key).catch(() => null)
      : null
  }))

  const result = withUrls.map(row => ({
    id: row.message_id,
    sender_id: row.sender_id,
    sender_name: row.sender_name,
    sender_avatar_url: avatarUrls[row.sender_id] ?? null,
    body: row.body,
    type: row.type,
    created_at: row.created_at,
    pinned_by_name: row.pinned_by_name,
    pinned_at: row.pinned_at,
  }))

  return NextResponse.json({ pins: result })
}

// POST { messageId, convId } — toggle pin
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CHAT_ROLES.includes(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try { await ensureTable() } catch {}

  const { messageId, convId } = await req.json()
  if (!messageId || !convId) return NextResponse.json({ error: 'messageId and convId required' }, { status: 400 })

  // Verify participant
  const part = await queryOne(`SELECT 1 FROM chat_participants WHERE conversation_id = $1 AND user_id = $2`, [convId, session.id]).catch(() => null)
  if (!part) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Check if already pinned
  const existing = await queryOne(`SELECT id FROM chat_pinned_messages WHERE conversation_id = $1 AND message_id = $2`, [convId, messageId]).catch(() => null)

  if (existing) {
    await query(`DELETE FROM chat_pinned_messages WHERE conversation_id = $1 AND message_id = $2`, [convId, messageId])
    return NextResponse.json({ pinned: false })
  } else {
    await query(
      `INSERT INTO chat_pinned_messages (conversation_id, message_id, pinned_by, pinned_by_name) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [convId, messageId, session.id, session.fullName]
    )
    return NextResponse.json({ pinned: true })
  }
}
