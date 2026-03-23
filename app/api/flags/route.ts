import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const resolved = searchParams.get('resolved') === 'true'

  let sql: string
  let params: unknown[]

  if (isManager(session.role) || session.role === 'developer') {
    sql = `
      SELECT f.*, u.full_name, u.username
      FROM flags f JOIN users u ON u.id = f.user_id
      WHERE f.resolved = $1 ORDER BY f.created_at DESC
    `
    params = [resolved]
  } else {
    sql = `
      SELECT f.*, u.full_name, u.username
      FROM flags f JOIN users u ON u.id = f.user_id
      WHERE f.user_id = $1 AND f.resolved = $2 ORDER BY f.created_at DESC
    `
    params = [session.id, resolved]
  }

  const flags = await query(sql, params)
  return NextResponse.json({ flags })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isManager(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { flagId } = await req.json()
  if (!flagId) return NextResponse.json({ error: 'Missing flagId' }, { status: 400 })

  await queryOne(
    `UPDATE flags SET resolved = TRUE, resolved_by = $1, resolved_at = NOW() WHERE id = $2`,
    [session.id, flagId]
  )
  return NextResponse.json({ ok: true })
}
