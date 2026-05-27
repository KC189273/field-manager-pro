import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query } from '@/lib/db'

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      type       TEXT,
      read       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC)`)
}

// GET /api/notifications — recent notifications for the session user
export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTable() } catch {}

  const rows = await query<{
    id: string; title: string; body: string; type: string | null; read: boolean; created_at: string
  }>(
    `SELECT id, title, body, type, read, created_at::text
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [session.id]
  )

  const unread = rows.filter(r => !r.read).length
  return NextResponse.json({ notifications: rows, unread })
}

// PATCH /api/notifications/read — mark all (or specific ids) as read
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ids: string[] | undefined = body.ids

  if (ids?.length) {
    await query(
      `UPDATE notifications SET read = TRUE WHERE user_id = $1 AND id = ANY($2)`,
      [session.id, ids]
    ).catch(() => {})
  } else {
    await query(
      `UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`,
      [session.id]
    ).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
