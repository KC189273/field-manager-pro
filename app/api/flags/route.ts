import { NextRequest, NextResponse } from 'next/server'
import { getSession, isManager, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'
import { getReceiptViewUrl } from '@/lib/s3'

let ensured = false
async function ensureFlagColumns() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE flags ADD COLUMN IF NOT EXISTS resolution_note TEXT`)
  await query(`ALTER TABLE flags ADD COLUMN IF NOT EXISTS resolved_by_name TEXT`)
  // Auto-resolve any open flags older than 7 days (retroactive + ongoing cleanup)
  await query(`
    UPDATE flags SET resolved = TRUE, resolved_at = NOW(), resolution_note = 'Auto-resolved after 7 days'
    WHERE resolved = FALSE AND created_at < NOW() - INTERVAL '7 days'
  `).catch(() => {})
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureFlagColumns() } catch {}

  const { searchParams } = new URL(req.url)
  const resolved = searchParams.get('resolved') === 'true'
  const orgFilter = await getOrgFilter(session)

  // Open flags only show within a 7-day window; resolved (history) view has no date cap
  const ageFilter = resolved ? '' : ` AND f.created_at >= NOW() - INTERVAL '7 days'`

  let sql: string
  let params: unknown[]

  if (session.role === 'manager') {
    // DMs only see flags from their own employees
    params = [session.id, resolved]
    sql = `
      SELECT f.*, u.full_name, u.username, u.avatar_key
      FROM flags f JOIN users u ON u.id = f.user_id
      WHERE u.manager_id = $1 AND f.resolved = $2${ageFilter} ORDER BY f.created_at DESC
    `
  } else if (session.role === 'ops_manager' || isOwner(session.role) || session.role === 'developer') {
    params = [resolved]
    const orgClause = appendOrgFilter(orgFilter, params)
    sql = `
      SELECT f.*, u.full_name, u.username, u.avatar_key
      FROM flags f JOIN users u ON u.id = f.user_id
      WHERE f.resolved = $1${orgClause}${ageFilter} ORDER BY f.created_at DESC
    `
  } else {
    params = [session.id, resolved]
    sql = `
      SELECT f.*, u.full_name, u.username, u.avatar_key
      FROM flags f JOIN users u ON u.id = f.user_id
      WHERE f.user_id = $1 AND f.resolved = $2${ageFilter} ORDER BY f.created_at DESC
    `
  }

  const rawFlags = await query(sql, params)
  const flags = await Promise.all(
    (rawFlags as Record<string, unknown>[]).map(async f => ({
      ...f,
      avatar_url: f.avatar_key ? await getReceiptViewUrl(f.avatar_key as string) : null,
    }))
  )
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
