import { NextRequest, NextResponse } from 'next/server'
import { getSession, isOwner } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'
import { sendEmail } from '@/lib/notifications'
import { sendPushToUser, isEmailEnabled } from '@/lib/apns'

const CATEGORIES = [
  'HVAC / Climate Control',
  'Plumbing',
  'Electrical',
  'Lighting',
  'Restroom / Sanitation',
  'Structural / Building',
  'Safety Hazard',
  'Equipment',
  'Other',
]

async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS facility_tickets (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id           UUID,
      store_id         UUID,
      store_address    TEXT,
      category         TEXT NOT NULL,
      custom_category  TEXT,
      title            TEXT NOT NULL,
      description      TEXT,
      urgency          TEXT NOT NULL DEFAULT 'normal',
      photo_key        TEXT,
      status           TEXT NOT NULL DEFAULT 'open',
      submitted_by     UUID REFERENCES users(id) ON DELETE SET NULL,
      submitted_by_name TEXT NOT NULL,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS facility_ticket_updates (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id       UUID REFERENCES facility_tickets(id) ON DELETE CASCADE,
      updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by_name TEXT NOT NULL,
      status          TEXT NOT NULL,
      note            TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

function facilityTicketHtml(
  submitterName: string,
  store: string,
  category: string,
  title: string,
  description: string | null,
  urgency: string,
): string {
  const urgencyColor = urgency === 'urgent' ? '#dc2626' : '#6b7280'
  const urgencyLabel = urgency === 'urgent' ? 'URGENT' : 'Normal'
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">New Facility Request</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:16px;font-weight:700;color:#1c1c1e;margin:0 0 16px;">${title}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">
          <tr><td style="padding:6px 0;color:#8e8e93;font-weight:600;width:120px;">Submitted by</td><td style="padding:6px 0;color:#1c1c1e;">${submitterName}</td></tr>
          <tr><td style="padding:6px 0;color:#8e8e93;font-weight:600;">Store</td><td style="padding:6px 0;color:#1c1c1e;">${store}</td></tr>
          <tr><td style="padding:6px 0;color:#8e8e93;font-weight:600;">Category</td><td style="padding:6px 0;color:#1c1c1e;">${category}</td></tr>
          <tr><td style="padding:6px 0;color:#8e8e93;font-weight:600;">Urgency</td><td style="padding:6px 0;font-weight:700;color:${urgencyColor};">${urgencyLabel}</td></tr>
          ${description ? `<tr><td style="padding:6px 0;color:#8e8e93;font-weight:600;vertical-align:top;">Details</td><td style="padding:6px 0;color:#1c1c1e;">${description}</td></tr>` : ''}
        </table>
        <a href="${process.env.APP_URL ?? 'https://fieldmanagerpro.app'}/facilities" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">View in Field Manager Pro</a>
      </div>
    </div>
  `
}

// GET /api/facility-tickets
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTables() } catch {}

  const { searchParams } = new URL(req.url)
  const statusFilter = searchParams.get('status') // open | in_progress | resolved | all

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = []
  let where = `1=1`

  if (statusFilter && statusFilter !== 'all') {
    params.push(statusFilter)
    where += ` AND ft.status = $${params.length}`
  }

  // Check if DM is an ops collaborator (gets full org visibility)
  let isOpsCollab = false
  if (session.role === 'manager') {
    const u = await queryOne<{ is_ops_collab: boolean }>(`SELECT is_ops_collab FROM users WHERE id = $1`, [session.id])
    isOpsCollab = u?.is_ops_collab ?? false
  }

  if (session.role === 'employee') {
    params.push(session.id)
    where += ` AND ft.submitted_by = $${params.length}`
  } else if (session.role === 'manager' && !isOpsCollab) {
    // DMs see tickets for their assigned stores only
    params.push(session.id)
    where += ` AND ft.store_id IN (
      SELECT store_location_id FROM dm_manager_stores WHERE manager_id = $${params.length}
    )`
  } else {
    // Ops+, ops-collab DMs, and devs see all org tickets
    where += appendOrgFilter(orgFilter, params, 'ft')
  }

  const tickets = await query<{
    id: string; store_address: string | null; category: string; custom_category: string | null
    title: string; description: string | null; urgency: string; photo_key: string | null
    status: string; submitted_by: string | null; submitted_by_name: string
    created_at: string; updated_at: string
  }>(`
    SELECT ft.id, ft.store_address, ft.category, ft.custom_category,
           ft.title, ft.description, ft.urgency, ft.photo_key,
           ft.status, ft.submitted_by, ft.submitted_by_name,
           ft.created_at::text, ft.updated_at::text
    FROM facility_tickets ft
    WHERE ${where}
    ORDER BY
      CASE ft.urgency WHEN 'urgent' THEN 0 ELSE 1 END,
      CASE ft.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
      ft.created_at DESC
  `, params)

  // Stores available for submission form
  let stores: { id: string; address: string }[] = []
  if (session.role === 'employee') {
    const user = await queryOne<{ manager_id: string | null }>(`SELECT manager_id FROM users WHERE id = $1`, [session.id])
    if (user?.manager_id) {
      stores = await query<{ id: string; address: string }>(
        `SELECT l.id, l.address FROM dm_store_locations l
         JOIN dm_manager_stores ms ON ms.store_location_id = l.id
         WHERE ms.manager_id = $1 AND l.active = TRUE ORDER BY l.address`,
        [user.manager_id]
      )
    }
  } else if (session.role === 'manager') {
    stores = await query<{ id: string; address: string }>(
      `SELECT l.id, l.address FROM dm_store_locations l
       JOIN dm_manager_stores ms ON ms.store_location_id = l.id
       WHERE ms.manager_id = $1 AND l.active = TRUE ORDER BY l.address`,
      [session.id]
    )
  } else {
    const sp: unknown[] = []
    const orgClause = appendOrgFilter(orgFilter, sp, 'l')
    stores = await query<{ id: string; address: string }>(
      `SELECT l.id, l.address FROM dm_store_locations l WHERE l.active = TRUE${orgClause} ORDER BY l.address`,
      sp
    )
  }

  return NextResponse.json({ tickets, stores, categories: CATEGORIES })
}

// POST /api/facility-tickets
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTables() } catch {}

  const { storeId, category, customCategory, title, description, urgency, photoKey } = await req.json()

  if (!storeId) return NextResponse.json({ error: 'Store is required' }, { status: 400 })
  if (!category) return NextResponse.json({ error: 'Category is required' }, { status: 400 })
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  if (!['urgent', 'normal'].includes(urgency)) return NextResponse.json({ error: 'Invalid urgency' }, { status: 400 })
  if (!photoKey) return NextResponse.json({ error: 'Photo is required' }, { status: 400 })

  const store = await queryOne<{ address: string }>(`SELECT address FROM dm_store_locations WHERE id = $1`, [storeId])
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

  const user = await queryOne<{ org_id: string | null }>(`SELECT org_id FROM users WHERE id = $1`, [session.id])
  const orgId = user?.org_id ?? null
  const displayCategory = category === 'Other' && customCategory ? customCategory : category

  const result = await queryOne<{ id: string }>(`
    INSERT INTO facility_tickets
      (org_id, store_id, store_address, category, custom_category, title, description, urgency, photo_key, submitted_by, submitted_by_name)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id
  `, [
    orgId, storeId, store.address,
    category, customCategory?.trim() || null,
    title.trim(), description?.trim() || null,
    urgency, photoKey,
    session.id, session.fullName,
  ])

  // Insert initial 'open' update record
  await query(`
    INSERT INTO facility_ticket_updates (ticket_id, updated_by, updated_by_name, status, note)
    VALUES ($1,$2,$3,'open','Ticket submitted')
  `, [result?.id, session.id, session.fullName])

  // Notify ops+ users and ops-collab DMs (push + email on initial submission)
  const recipients = await query<{ id: string; email: string; full_name: string }>(
    `SELECT id, email, full_name FROM users
     WHERE is_active = TRUE
       AND (
         (role IN ('sales_director', 'owner', 'developer', 'ops_manager') AND (org_id = $1 OR role = 'developer'))
         OR (role = 'manager' AND is_ops_collab = TRUE AND org_id = $1)
       )`,
    [orgId]
  )

  const urgencyLabel = urgency === 'urgent' ? '[URGENT] ' : ''
  for (const r of recipients) {
    sendPushToUser(r.id, `${urgencyLabel}New Facility Request`, `${session.fullName} — ${title.trim()}`, 'facility_request').catch(() => {})
    if (r.email && await isEmailEnabled(r.id)) {
      sendEmail(
        r.email,
        `${urgencyLabel}New Facility Request: ${title.trim()}`,
        facilityTicketHtml(session.fullName, store.address, displayCategory, title.trim(), description?.trim() || null, urgency)
      ).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true, id: result?.id })
}
