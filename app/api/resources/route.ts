import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'
import { getReceiptViewUrl } from '@/lib/s3'

export const dynamic = 'force-dynamic'

// Roles that can manage (create/edit/delete) resources
const CAN_MANAGE = ['owner', 'ops_manager', 'developer', 'sales_director']
// All roles can read
const CAN_READ = ['employee', 'manager', 'ops_manager', 'owner', 'sales_director', 'developer']

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`ALTER TABLE resources ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {})

  await query(`
    CREATE TABLE IF NOT EXISTS resources (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id        UUID,
      type          TEXT NOT NULL DEFAULT 'document',
      title         TEXT NOT NULL,
      body          TEXT,
      url           TEXT,
      s3_key        TEXT,
      filename      TEXT,
      contact_name  TEXT,
      contact_role  TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
      sort_order    INT NOT NULL DEFAULT 0,
      is_visible    BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {})
}

// GET /api/resources
// Returns all visible resources for the org — readable by all roles
export async function GET() {
  const session = await getSession()
  if (!session || !CAN_READ.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTable() } catch {}

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = []

  // Build org clause: include items belonging to the user's org OR global items (org_id IS NULL)
  let orgWhereClause = ''
  if (orgFilter.filterByOrg && orgFilter.orgId) {
    params.push(orgFilter.orgId)
    orgWhereClause = ` AND (r.org_id = $${params.length} OR r.org_id IS NULL)`
  } else if (orgFilter.filterByOrg && !orgFilter.orgId) {
    orgWhereClause = ` AND r.org_id IS NULL`
  }
  // filterByOrg = false (developer viewing all) → no clause, see everything

  const resources = await query<{
    id: string
    type: string
    title: string
    body: string | null
    url: string | null
    s3_key: string | null
    filename: string | null
    contact_name: string | null
    contact_role: string | null
    contact_phone: string | null
    contact_email: string | null
    created_by: string | null
    created_by_name: string | null
    sort_order: number
    created_at: string
  }>(`
    SELECT r.id::text, r.type, r.title, r.body, r.url,
           r.s3_key, r.filename,
           r.contact_name, r.contact_role, r.contact_phone, r.contact_email,
           r.created_by::text,
           u.full_name AS created_by_name,
           r.sort_order, r.is_pinned, r.created_at::text,
           cu.avatar_key AS contact_avatar_key
    FROM resources r
    LEFT JOIN users u ON u.id = r.created_by
    LEFT JOIN users cu ON r.type = 'contact' AND LOWER(cu.email) = LOWER(r.contact_email) AND cu.is_active = TRUE
    WHERE r.is_visible = TRUE${orgWhereClause}
    ORDER BY r.sort_order ASC, r.created_at DESC
  `, params)

  // Resolve contact avatar URLs
  const resourcesWithAvatars = await Promise.all(
    (resources as Record<string, unknown>[]).map(async r => {
      let contact_avatar_url: string | null = null
      if (r.contact_avatar_key) {
        try { contact_avatar_url = await getReceiptViewUrl(r.contact_avatar_key as string) } catch { /* non-fatal */ }
      }
      return { ...r, contact_avatar_url }
    })
  )

  return NextResponse.json({ resources: resourcesWithAvatars })
}

// POST /api/resources
// Creates a new resource (admin roles only)
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !CAN_MANAGE.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try { await ensureTable() } catch {}

  const {
    type, title, body, url, s3Key, filename,
    contactName, contactRole, contactPhone, contactEmail,
    sortOrder,
  } = await req.json()

  if (!type || !title?.trim()) {
    return NextResponse.json({ error: 'type and title are required' }, { status: 400 })
  }

  const validTypes = ['announcement', 'document', 'link', 'contact']
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  const orgFilter = await getOrgFilter(session)
  const orgId = orgFilter.filterByOrg ? orgFilter.orgId : null

  const result = await queryOne<{ id: string }>(`
    INSERT INTO resources
      (org_id, type, title, body, url, s3_key, filename,
       contact_name, contact_role, contact_phone, contact_email,
       created_by, sort_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING id::text as id
  `, [
    orgId, type, title.trim(),
    body?.trim() || null, url?.trim() || null,
    s3Key || null, filename || null,
    contactName?.trim() || null, contactRole?.trim() || null,
    contactPhone?.trim() || null, contactEmail?.trim() || null,
    session.id, sortOrder ?? 0,
  ])

  return NextResponse.json({ ok: true, id: result?.id })
}

// PATCH /api/resources
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !CAN_MANAGE.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()

  // Pin / unpin: { pin: id } or { unpin: id }
  if (body.pin) {
    const pinCount = await query<{ count: string }>(
      `SELECT COUNT(*) FROM resources WHERE is_pinned = TRUE`
    )
    if (parseInt(pinCount[0]?.count ?? '0') >= 4) {
      return NextResponse.json({ error: 'Maximum 4 items can be pinned. Unpin one first.' }, { status: 400 })
    }
    await query(`UPDATE resources SET is_pinned = TRUE, updated_at = NOW() WHERE id = $1`, [body.pin])
    return NextResponse.json({ ok: true })
  }
  if (body.unpin) {
    await query(`UPDATE resources SET is_pinned = FALSE, updated_at = NOW() WHERE id = $1`, [body.unpin])
    return NextResponse.json({ ok: true })
  }

  // Bulk reorder: { reorder: [{id, sort_order}, ...] }
  if (Array.isArray(body.reorder)) {
    for (const { id, sort_order } of body.reorder) {
      await query(`UPDATE resources SET sort_order = $1, updated_at = NOW() WHERE id = $2`, [sort_order, id])
    }
    return NextResponse.json({ ok: true })
  }

  const {
    id, type, title, url, s3Key, filename,
    contactName, contactRole, contactPhone, contactEmail,
    sortOrder, isVisible,
  } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = await queryOne(`SELECT id FROM resources WHERE id = $1`, [id])
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const bodyText = body.body ?? null

  await query(`
    UPDATE resources SET
      type          = COALESCE($1, type),
      title         = COALESCE($2, title),
      body          = COALESCE($3, body),
      url           = COALESCE($4, url),
      s3_key        = COALESCE($5, s3_key),
      filename      = COALESCE($6, filename),
      contact_name  = COALESCE($7, contact_name),
      contact_role  = COALESCE($8, contact_role),
      contact_phone = COALESCE($9, contact_phone),
      contact_email = COALESCE($10, contact_email),
      sort_order    = COALESCE($11, sort_order),
      is_visible    = COALESCE($12, is_visible),
      updated_at    = NOW()
    WHERE id = $13
  `, [
    type ?? null, title?.trim() ?? null,
    bodyText?.trim() ?? null, url?.trim() ?? null,
    s3Key ?? null, filename ?? null,
    contactName?.trim() ?? null, contactRole?.trim() ?? null,
    contactPhone?.trim() ?? null, contactEmail?.trim() ?? null,
    sortOrder ?? null, isVisible ?? null,
    id,
  ])

  return NextResponse.json({ ok: true })
}

// DELETE /api/resources
export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !CAN_MANAGE.includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await query(`DELETE FROM resources WHERE id = $1`, [id])
  return NextResponse.json({ ok: true })
}
