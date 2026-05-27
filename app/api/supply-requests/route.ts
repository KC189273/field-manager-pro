import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { query, queryOne } from '@/lib/db'
import { sendPushToUser, sendPushToUsers, isEmailEnabled } from '@/lib/apns'
import { sendEmail } from '@/lib/notifications'
import { getOrgFilter, appendOrgFilter } from '@/lib/org'

const APP_URL = process.env.APP_URL ?? 'https://fieldmanagerpro.app'

function supplyRequestEmailHtml(dmName: string, employeeName: string, itemName: string, quantity: string, urgency: number, store: string | null, notes: string | null): string {
  const urgencyLabel = urgency === 1 ? 'Level 1 — Within 24 Hours' : urgency === 2 ? 'Level 2 — Within 72 Hours' : 'Level 3 — Within 1 Week'
  const urgencyColor = urgency === 1 ? '#dc2626' : urgency === 2 ? '#d97706' : '#ca8a04'
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#7c3aed;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:20px;">Field Manager Pro</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px;">New Supply Request</p>
      </div>
      <div style="background:white;border:1px solid #e5e5ea;border-radius:0 0 12px 12px;padding:24px;">
        <p style="font-size:15px;color:#1c1c1e;margin:0 0 16px;">Hi ${dmName}, <strong>${employeeName}</strong> has submitted a supply request that needs your attention.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
          <tr style="background:#f2f2f7;"><td style="padding:8px 12px;font-weight:600;color:#8e8e93;width:110px;">Item</td><td style="padding:8px 12px;color:#1c1c1e;font-weight:700;">${itemName}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;color:#8e8e93;">Quantity</td><td style="padding:8px 12px;color:#1c1c1e;">${quantity}</td></tr>
          <tr style="background:#f2f2f7;"><td style="padding:8px 12px;font-weight:600;color:#8e8e93;">Urgency</td><td style="padding:8px 12px;font-weight:700;color:${urgencyColor};">${urgencyLabel}</td></tr>
          ${store ? `<tr><td style="padding:8px 12px;font-weight:600;color:#8e8e93;">Store</td><td style="padding:8px 12px;color:#1c1c1e;">${store}</td></tr>` : ''}
          ${notes ? `<tr style="background:#f2f2f7;"><td style="padding:8px 12px;font-weight:600;color:#8e8e93;vertical-align:top;">Notes</td><td style="padding:8px 12px;color:#1c1c1e;">${notes}</td></tr>` : ''}
        </table>
        <a href="${APP_URL}/supply-requests" style="display:inline-block;background:#7c3aed;color:white;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">View in Field Manager Pro</a>
      </div>
    </div>
  `
}

export const URGENCY_HOURS: Record<number, number> = { 1: 24, 2: 72, 3: 168 }

let ensured = false
async function ensureTable() {
  if (ensured) return
  ensured = true
  await query(`
    CREATE TABLE IF NOT EXISTS supply_requests (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id               UUID,
      employee_id          UUID REFERENCES users(id) ON DELETE SET NULL,
      employee_name        TEXT NOT NULL,
      manager_id           UUID REFERENCES users(id) ON DELETE SET NULL,
      manager_name         TEXT,
      store_location_id    UUID,
      store_address        TEXT,
      item_name            TEXT NOT NULL,
      quantity             TEXT NOT NULL DEFAULT '1',
      category             TEXT,
      notes                TEXT,
      urgency              SMALLINT NOT NULL DEFAULT 2,
      status               TEXT NOT NULL DEFAULT 'pending',
      ordered_at           TIMESTAMPTZ,
      ordered_by           UUID,
      ordered_by_name      TEXT,
      ordered_note         TEXT,
      received_at          TIMESTAMPTZ,
      received_by          UUID,
      received_by_name     TEXT,
      order_escalated_at   TIMESTAMPTZ,
      receipt_escalated_at TIMESTAMPTZ,
      created_at           TIMESTAMPTZ DEFAULT NOW(),
      updated_at           TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

// GET /api/supply-requests
// Params: history=true, from=YYYY-MM-DD, to=YYYY-MM-DD, managerId=, storeId=
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTable() } catch {}

  const { searchParams } = new URL(req.url)
  const history   = searchParams.get('history') === 'true'
  const filterMgr = searchParams.get('managerId')
  const filterStore = searchParams.get('storeId')
  const fromDate  = searchParams.get('from')
  const toDate    = searchParams.get('to')

  const orgFilter = await getOrgFilter(session)
  const params: unknown[] = []

  let where = history
    ? `sr.status = 'received'`
    : `sr.status IN ('pending', 'ordered')`

  if (fromDate) { params.push(fromDate); where += ` AND sr.created_at >= $${params.length}` }
  if (toDate)   { params.push(toDate + 'T23:59:59'); where += ` AND sr.created_at <= $${params.length}` }

  // Check if DM is an ops collaborator
  let isOpsCollab = false
  if (session.role === 'manager') {
    const u = await queryOne<{ is_ops_collab: boolean }>(`SELECT is_ops_collab FROM users WHERE id = $1`, [session.id])
    isOpsCollab = u?.is_ops_collab ?? false
  }

  if (session.role === 'employee') {
    params.push(session.id)
    where += ` AND sr.employee_id = $${params.length}`
  } else if (session.role === 'manager' && !isOpsCollab) {
    params.push(session.id)
    where += ` AND sr.manager_id = $${params.length}`
  } else {
    where += appendOrgFilter(orgFilter, params, 'sr')
    if (filterMgr)   { params.push(filterMgr);   where += ` AND sr.manager_id = $${params.length}` }
    if (filterStore) { params.push(filterStore); where += ` AND sr.store_location_id = $${params.length}` }
  }

  const requests = await query(`
    SELECT sr.*,
           sr.created_at::text,
           sr.ordered_at::text,
           sr.received_at::text,
           sr.order_escalated_at::text,
           sr.receipt_escalated_at::text,
           sr.updated_at::text
    FROM supply_requests sr
    WHERE ${where}
    ORDER BY sr.urgency ASC, sr.created_at ASC
  `, params)

  // For employees and DMs: return store list for the submit form
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
  }

  // For ops+ and ops-collab DMs: return DM list and store list for filters
  let managers: { id: string; full_name: string }[] = []
  let allStores: { id: string; address: string }[] = []
  if (!['employee', 'manager'].includes(session.role) || isOpsCollab) {
    const mgrParams: unknown[] = []
    managers = await query<{ id: string; full_name: string }>(
      `SELECT u.id, u.full_name FROM users u WHERE u.role = 'manager' AND u.is_active = TRUE${appendOrgFilter(orgFilter, mgrParams, 'u')} ORDER BY u.full_name`,
      mgrParams
    )
    const storeParams: unknown[] = []
    allStores = await query<{ id: string; address: string }>(
      `SELECT l.id, l.address FROM dm_store_locations l WHERE l.active = TRUE${appendOrgFilter(orgFilter, storeParams, 'l')} ORDER BY l.address`,
      storeParams
    )
  }

  return NextResponse.json({ requests, stores, managers, allStores })
}

// POST /api/supply-requests — employee submits
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { await ensureTable() } catch {}

  const { itemName, quantity, category, notes, urgency, storeLocationId } = await req.json()
  if (!itemName?.trim())         return NextResponse.json({ error: 'Item name is required' }, { status: 400 })
  if (![1, 2, 3].includes(urgency)) return NextResponse.json({ error: 'Invalid urgency level' }, { status: 400 })

  const user = await queryOne<{ manager_id: string | null; org_id: string | null }>(
    `SELECT manager_id, org_id FROM users WHERE id = $1`, [session.id]
  )

  // DMs submitting for themselves are their own manager on the record
  let managerId: string | null
  let managerName: string | null
  if (session.role === 'manager') {
    managerId = session.id
    managerName = session.fullName
  } else {
    managerId = user?.manager_id ?? null
    const manager = managerId
      ? await queryOne<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [managerId])
      : null
    managerName = manager?.full_name ?? null
  }

  let storeAddress: string | null = null
  if (storeLocationId) {
    const store = await queryOne<{ address: string }>(`SELECT address FROM dm_store_locations WHERE id = $1`, [storeLocationId])
    storeAddress = store?.address ?? null
  }

  await query(`
    INSERT INTO supply_requests
      (org_id, employee_id, employee_name, manager_id, manager_name,
       store_location_id, store_address, item_name, quantity, category, notes, urgency)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [
    user?.org_id ?? null,
    session.id, session.fullName,
    managerId, managerName,
    storeLocationId ?? null, storeAddress,
    itemName.trim(),
    quantity?.trim() || '1',
    category || null,
    notes?.trim() || null,
    urgency,
  ])

  // Only notify the DM if the submitter is an employee (DMs don't notify themselves)
  if (managerId && session.role !== 'manager') {
    const lvl = urgency === 1 ? 'Level 1 — 24 hrs' : urgency === 2 ? 'Level 2 — 72 hrs' : 'Level 3 — 1 week'
    sendPushToUser(
      managerId,
      'New Supply Request',
      `${session.fullName} needs "${itemName.trim()}" (${lvl})`,
      'supply_request'
    ).catch(() => {})

    // Email the DM
    const mgr = await queryOne<{ email: string | null; full_name: string }>(
      `SELECT email, full_name FROM users WHERE id = $1`, [managerId]
    )
    if (mgr?.email && await isEmailEnabled(managerId)) {
      sendEmail(
        mgr.email,
        `New Supply Request: ${itemName.trim()}`,
        supplyRequestEmailHtml(mgr.full_name, session.fullName, itemName.trim(), quantity?.trim() || '1', urgency, storeAddress, notes?.trim() || null)
      ).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true })
}

// PATCH /api/supply-requests — DM marks ordered, employee marks received
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, action, note } = await req.json()
  if (!id || !action) return NextResponse.json({ error: 'id and action required' }, { status: 400 })

  const row = await queryOne<{
    employee_id: string; employee_name: string
    manager_id: string | null; item_name: string; status: string; urgency: number; org_id: string | null
  }>(`SELECT employee_id, employee_name, manager_id, item_name, status, urgency, org_id FROM supply_requests WHERE id = $1`, [id])
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (action === 'ordered') {
    if (session.role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (session.role === 'manager' && row.manager_id !== session.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (row.status !== 'pending') return NextResponse.json({ error: 'Already ordered' }, { status: 400 })

    await query(
      `UPDATE supply_requests SET status='ordered', ordered_at=NOW(), ordered_by=$1, ordered_by_name=$2, ordered_note=$3, updated_at=NOW() WHERE id=$4`,
      [session.id, session.fullName, note?.trim() || null, id]
    )
    sendPushToUser(
      row.employee_id,
      'Supplies Ordered!',
      `Your request for "${row.item_name}" has been ordered and is on the way.`,
      'supply_ordered'
    ).catch(() => {})

  } else if (action === 'received') {
    const canReceive = row.employee_id === session.id ||
      ['manager', 'ops_manager', 'owner', 'sales_director', 'developer'].includes(session.role)
    if (!canReceive) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (row.status !== 'ordered') return NextResponse.json({ error: 'Must be ordered first' }, { status: 400 })

    await query(
      `UPDATE supply_requests SET status='received', received_at=NOW(), received_by=$1, received_by_name=$2, updated_at=NOW() WHERE id=$3`,
      [session.id, session.fullName, id]
    )
    if (row.manager_id) {
      sendPushToUser(
        row.manager_id,
        'Supplies Received',
        `${row.employee_name} confirmed receipt of "${row.item_name}".`,
        'supply_received'
      ).catch(() => {})
    }

  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
