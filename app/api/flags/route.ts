import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'

let ensured = false
async function ensureFlagColumns() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE flags ADD COLUMN IF NOT EXISTS resolution_note TEXT`)
  await query(`ALTER TABLE flags ADD COLUMN IF NOT EXISTS resolved_by_name TEXT`)
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const resolved = searchParams.get('resolved') === 'true'
  const orgFilter = await getOrgFilter(session)

  let sql: string
  let params: unknown[]

  if (session.role === 'manager') {
    // DMs only see flags from their own employees
    params = [session.id, resolved]
    sql = `
      SELECT f.*, u.full_name, u.username
      FROM flags f JOIN users u ON u.id = f.user_id
      WHERE u.manager_id = $1 AND f.resolved = $2 ORDER BY f.created_at DESC
    `
  } else if (session.role === 'ops_manager' || isOwner(session.role) || session.role === 'developer') {
    params = [resolved]
    const orgClause = appendOrgFilter(orgFilter, params)
    sql = `
      SELECT f.*, u.full_name, u.username
      FROM flags f JOIN users u ON u.id = f.user_id
      WHERE f.resolved = $1${orgClause} ORDER BY f.created_at DESC
    `
  } else {
    params = [session.id, resolved]
    sql = `
      SELECT f.*, u.full_name, u.username
      FROM flags f JOIN users u ON u.id = f.user_id
      WHERE f.user_id = $1 AND f.resolved = $2 ORDER BY f.created_at DESC
    `
  }

  const flags = await query(sql, params)
  return NextResponse.json({ flags })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || (!isManager(session.role) && !isOwner(session.role) && session.role !== 'developer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { flagId, note } = await req.json()
  if (!flagId) return NextResponse.json({ error: 'Missing flagId' }, { status: 400 })

  try { await ensureFlagColumns() } catch {}

  await queryOne(
    `UPDATE flags SET resolved = TRUE, resolved_by = $1, resolved_by_name = $2, resolved_at = NOW(), resolution_note = $3 WHERE id = $4`,
    [session.id, session.fullName, note?.trim() || null, flagId]
  )
  return NextResponse.json({ ok: true })
}
